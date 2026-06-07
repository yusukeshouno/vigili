import SwiftUI
import UIKit

/// 初回起動 / 未設定時に出る Setup 画面。
/// PWA の Setup と同じ情報を聞く: daemon URL + access token。
struct MobileSetupView: View {
  @EnvironmentObject private var coordinator: MobileAppCoordinator

  /// Welcome 経由で来た場合、自動で scanner を開く。
  var autoOpenScanner: Bool = false

  @State private var daemonUrl: String = MobileSettings.lanUrl ?? ""
  @State private var token: String = MobileSettings.lanToken ?? ""
  @State private var showToken: Bool = false
  @State private var error: String? = nil
  @State private var showScanner: Bool = false
  @State private var didAutoOpen: Bool = false
  @StateObject private var bonjour = BonjourBrowser()

  var body: some View {
    ScrollView {
      VStack(spacing: 24) {
          // ヘッダー
          VStack(spacing: 12) {
            FlowerLogo(color: Theme.accent, size: 44)
            Text("Vigili")
              .font(.display(28, weight: .semibold))
              .foregroundStyle(Theme.fg)
            Text("Connect to your Mac daemon")
              .monoLabel(11, tracking: 0.15)
              .foregroundStyle(Theme.fgDim)
          }
          .padding(.top, 60)
          .padding(.bottom, 12)

          // Bonjour 自動検出
          discoveredSection

          // フォーム
          VStack(alignment: .leading, spacing: 18) {
            field(
              title: "Daemon URL",
              hint: "e.g. 192.168.1.42 or macbook-pro-5.local",
              text: $daemonUrl,
              isSecure: false
            )

            field(
              title: "Access token",
              hint: "from cat ~/.sentinel/token on your Mac",
              text: $token,
              isSecure: !showToken,
              trailing: {
                Button {
                  showToken.toggle()
                } label: {
                  Image(systemName: showToken ? "eye.slash" : "eye")
                    .foregroundStyle(Theme.fgMid)
                }
              }
            )

            if let err = error {
              Text(err)
                .font(.mono(11))
                .foregroundStyle(Theme.red)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                  RoundedRectangle(cornerRadius: 8)
                    .fill(Theme.red.opacity(0.08))
                )
            }
          }
          .padding(20)
          .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
              .fill(Theme.bgRise)
          )
          .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
              .stroke(Theme.border, lineWidth: 1)
          )

          // Scan QR でワンタップ設定
          PillButton(
            label: "Scan QR from Mac",
            icon: "qrcode.viewfinder",
            style: .ghost,
            action: { showScanner = true }
          )

          // クリップボードに sentinel://... または {"u":...,"t":...} が入っていれば
          // 1 タップで両フィールドを埋めて即接続。
          PillButton(
            label: "Paste from clipboard",
            icon: "doc.on.clipboard",
            style: .ghost,
            action: pasteFromClipboard
          )

          PillButton(
            label: "Connect",
            icon: "arrow.right",
            style: .primary,
            action: connect
          )

          // Mac 側で叩くコマンドのヒント。タップで iPhone クリップボードに copy
          // → Universal Clipboard で Mac のターミナルにも貼れる。
          macCommandsCard

          Text("Token stored locally on this device")
            .monoLabel(9, tracking: 0.18)
            .foregroundStyle(Theme.fgFaint)
            .padding(.top, 4)

          Spacer(minLength: 40)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Theme.bg.ignoresSafeArea())
    .fullScreenCover(isPresented: $showScanner) {
      MobileQRScanner(
        onScanned: handleScanned,
        onCancel: { showScanner = false }
      )
    }
    .onAppear {
      bonjour.start()
      // Welcome 画面から「Scan setup QR」で来たときに scanner を自動 open
      if autoOpenScanner, !didAutoOpen {
        didAutoOpen = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
          showScanner = true
        }
      }
    }
    .onDisappear { bonjour.stop() }
  }

  /// Mac で叩くコマンドの控え。タップで iPhone clipboard にコピー →
  /// Universal Clipboard で Mac のターミナルにそのまま貼れる。
  @State private var copiedCommand: String? = nil

  private var macCommandsCard: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 6) {
        Image(systemName: "terminal")
          .font(.system(size: 11))
          .foregroundStyle(Theme.fgMid)
        Text("RUN ON YOUR MAC")
          .font(.mono(10, weight: .medium))
          .tracking(0.12 * 10)
          .foregroundStyle(Theme.fgMid)
        Spacer()
      }

      commandRow(
        cmd: "sentinel-cli setup-link --copy",
        hint: "Copies a sentinel:// URL — paste here below"
      )
      commandRow(
        cmd: "sentinel-cli setup-qr",
        hint: "Prints a QR — scan with Camera or Scan QR button above"
      )

      if let just = copiedCommand {
        Text("Copied: \(just)")
          .font(.mono(9))
          .foregroundStyle(Theme.green)
          .padding(.top, 2)
      }
    }
    .padding(14)
    .background(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .fill(Theme.bgCode)
    )
    .overlay(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .stroke(Theme.border, lineWidth: 1)
    )
  }

  private func commandRow(cmd: String, hint: String) -> some View {
    Button {
      UIPasteboard.general.string = cmd
      copiedCommand = cmd
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
      // 数秒後にバナーを消す
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
        if copiedCommand == cmd { copiedCommand = nil }
      }
    } label: {
      VStack(alignment: .leading, spacing: 3) {
        HStack(spacing: 8) {
          Text("$")
            .font(.mono(11))
            .foregroundStyle(Theme.accent)
          Text(cmd)
            .font(.mono(11))
            .foregroundStyle(Theme.fg)
            .lineLimit(1)
            .truncationMode(.tail)
          Spacer()
          Image(systemName: copiedCommand == cmd ? "checkmark" : "doc.on.doc")
            .font(.system(size: 10))
            .foregroundStyle(copiedCommand == cmd ? Theme.green : Theme.fgDim)
        }
        Text(hint)
          .font(.mono(9))
          .foregroundStyle(Theme.fgDim)
          .lineLimit(2)
          .multilineTextAlignment(.leading)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 8).fill(Theme.bg.opacity(0.5))
      )
    }
    .buttonStyle(.plain)
  }

  /// 同 LAN にいる Sentinel daemon (Mac) を Bonjour で見つけたら
  /// 「Connect to <name>」ボタンを並べる。token は別途 QR / paste / 手入力。
  @ViewBuilder
  private var discoveredSection: some View {
    let resolved = bonjour.services.filter { $0.resolvedURL != nil }
    if !resolved.isEmpty {
      VStack(alignment: .leading, spacing: 10) {
        HStack(spacing: 6) {
          Image(systemName: "wifi")
            .font(.system(size: 11))
            .foregroundStyle(Theme.fgMid)
          Text("FOUND ON YOUR NETWORK")
            .font(.mono(10, weight: .medium))
            .tracking(0.12 * 10)
            .foregroundStyle(Theme.fgMid)
          Spacer()
        }
        ForEach(resolved) { svc in
          Button {
            if let url = svc.resolvedURL, let host = url.host {
              // ポート付きで保存 (MobileSettings.wsUrlBase は :7878 を補完するが、
              // Bonjour が見つけたポートが 7878 以外でも対応できるよう明示)
              if let port = url.port {
                daemonUrl = "\(host):\(port)"
              } else {
                daemonUrl = host
              }
            }
          } label: {
            HStack(spacing: 10) {
              FlowerLogo(color: Theme.accent, size: 14)
              VStack(alignment: .leading, spacing: 2) {
                Text(svc.name)
                  .font(.display(13, weight: .medium))
                  .foregroundStyle(Theme.fg)
                if let url = svc.resolvedURL {
                  Text(url.host ?? "—")
                    .font(.mono(10))
                    .foregroundStyle(Theme.fgDim)
                    .lineLimit(1)
                }
              }
              Spacer()
              Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Theme.fgMid)
            }
            .padding(14)
            .background(
              RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Theme.bgRise)
            )
            .overlay(
              RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Theme.borderStrong, lineWidth: 1)
            )
          }
          .buttonStyle(.plain)
        }
      }
    } else if bonjour.isBrowsing {
      HStack(spacing: 6) {
        ProgressView().controlSize(.mini)
        Text("Looking for Sentinel on this network…")
          .font(.mono(10))
          .foregroundStyle(Theme.fgDim)
      }
      .padding(.vertical, 4)
    }
  }

  /// QR から取り出したペイロードを 設定 → 接続まで一気に進める。
  /// クリップボード貼り付けと同じパーサ (3 形式対応) を使うので、QR の中身が
  /// sentinel:// URL でも JSON でも 2 行テキストでも OK。
  private func handleScanned(_ payload: String) {
    showScanner = false
    if !applyAnyPayload(payload.trimmingCharacters(in: .whitespacesAndNewlines)) {
      error = "QR の中身を解釈できませんでした"
    }
  }

  @ViewBuilder
  private func field<Trailing: View>(
    title: String,
    hint: String,
    text: Binding<String>,
    isSecure: Bool,
    @ViewBuilder trailing: () -> Trailing = { EmptyView() }
  ) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title)
        .monoLabel(10, weight: .medium)
        .foregroundStyle(Theme.fgMid)
      HStack(spacing: 8) {
        Group {
          if isSecure {
            SecureField("", text: text)
          } else {
            TextField("", text: text)
          }
        }
        .font(.mono(13))
        .foregroundStyle(Theme.fg)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled(true)
        trailing()
      }
      .padding(12)
      .background(
        RoundedRectangle(cornerRadius: 10).fill(Theme.bgCode)
      )
      .overlay(
        RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1)
      )
      Text(hint)
        .font(.mono(10))
        .foregroundStyle(Theme.fgDim)
    }
  }

  /// クリップボードの中身を 3 形式パーサに通す。
  private func pasteFromClipboard() {
    let raw = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if raw.isEmpty {
      error = "クリップボードが空です"
      return
    }
    if !applyAnyPayload(raw) {
      error = "クリップボードの形式が読めません (期待: vigili://pair…/sentinel://… / {\"u\":…,\"t\":…} / 2 行テキスト)"
    }
  }

  /// QR スキャン と クリップボード貼り付け の両方が使う共通パーサ。
  /// 入力が以下のどれかなら設定 → 接続まで進めて true、それ以外は false。
  ///   ① `vigili://pair?p=<pid>&u=<user_token>&r=<relay_url>` (Vigili Cloud)
  ///   ② `sentinel://setup?u=...&t=...` (LAN/Tailscale 直結)
  ///   ③ `{"u": "...", "t": "..."}` (互換: "url"/"token" キーも可)
  ///   ④ 1 行目 = URL、2 行目 = token の生テキスト
  @discardableResult
  private func applyAnyPayload(_ raw: String) -> Bool {
    // ① vigili://pair → relay 経由
    if raw.hasPrefix("vigili://pair") {
      if let url = URL(string: raw),
         let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) {
        let items = comps.queryItems ?? []
        let p = items.first(where: { $0.name == "p" })?.value ?? ""
        let u = items.first(where: { $0.name == "u" })?.value ?? ""
        let r = items.first(where: { $0.name == "r" })?.value ?? ""
        let trimmedP = p.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedU = u.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedR = r.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedP.isEmpty, !trimmedU.isEmpty, !trimmedR.isEmpty {
          // SECURITY: relay は Vigili 運用の単一ホストのみ。悪意ある QR で
          // 接続先を攻撃者 relay に差し替えられるのを防ぐ。
          guard RelayConstants.isTrustedRelayURL(trimmedR) else {
            error = "信頼できない relay URL です"
            return false
          }
          // relay 経路は別チャンネルに保存 (LAN credentials は消さない)
          MobileSettings.relayUrl = trimmedR
          MobileSettings.relayPid = trimmedP
          MobileSettings.relayUserToken = trimmedU
          error = nil
          coordinator.reconfigureAndConnect()
          return true
        }
      }
    }
    // ② vigili://setup または sentinel://setup URL (LAN/Tailscale 直結)
    //    vigili-daemon qr は vigili://setup?u=...&t=... を生成する。
    //    WelcomeView (Mac) は sentinel://setup?u=...&t=... を生成する (移行期)。
    if raw.hasPrefix("vigili://setup") || raw.hasPrefix("sentinel://") {
      if let url = URL(string: raw),
         let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) {
        let items = comps.queryItems ?? []
        let u = items.first(where: { $0.name == "u" })?.value ?? ""
        let t = items.first(where: { $0.name == "t" })?.value ?? ""
        if applyValues(u: u, t: t) { return true }
      }
    }
    // ③ JSON
    if raw.hasPrefix("{") {
      if let data = raw.data(using: .utf8),
         let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        let u = (json["u"] as? String) ?? (json["url"] as? String) ?? ""
        let t = (json["t"] as? String) ?? (json["token"] as? String) ?? ""
        if applyValues(u: u, t: t) { return true }
      }
    }
    // ③ 2 行
    let lines = raw.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
    if lines.count >= 2 {
      if applyValues(u: lines[0], t: lines[1]) { return true }
    }
    return false
  }

  @discardableResult
  private func applyValues(u: String, t: String) -> Bool {
    let trimmedU = u.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedT = t.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedU.isEmpty, !trimmedT.isEmpty else { return false }
    daemonUrl = trimmedU
    token = trimmedT
    error = nil
    MobileSettings.lanUrl = trimmedU
    MobileSettings.lanToken = trimmedT
    coordinator.reconfigureAndConnect()
    return true
  }

  private func connect() {
    let trimmedUrl = daemonUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedUrl.isEmpty else {
      error = "daemon URL を入力してください"
      return
    }
    guard !trimmedToken.isEmpty else {
      error = "access token を入力してください"
      return
    }
    error = nil
    MobileSettings.lanUrl = trimmedUrl
    MobileSettings.lanToken = trimmedToken
    coordinator.reconfigureAndConnect()
  }
}
