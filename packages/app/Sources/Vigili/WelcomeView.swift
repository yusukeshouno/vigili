import AppKit
import CoreImage.CIFilterBuiltins
import Foundation
import SwiftUI

/// 初回起動時のオンボーディング。
///
/// 目的:
///  1. 「Vigili が何のためのアプリか」を 3 行で伝える
///  2. iPhone との接続 QR を 1 画面で出して、Camera.app から取り込ませる
///  3. 「Got it」で marker file を書いて二度と出さない (AppCoordinator.dismissWelcome)
///
/// QR は unified スキーマ:
///   `vigili://setup?u=<lan>&t=<lan_token>[&r=<relay>&p=<pid>&k=<user_token>]`
/// relay が設定済みなら r/p/k も同梱され、LAN + 外出先の両方に 1 QR で対応。
/// 未設定なら「外出先でも使う」ボタンから `vigili-cli pair` を案内する。
struct WelcomeView: View {
  @EnvironmentObject private var coordinator: AppCoordinator
  @State private var showPairInstructions = false

  var body: some View {
    // 中段 (header〜remote) はスクロール可能にし、footer は常に最下部に固定する。
    // MenuBarExtra(.window) は内容を縦に伸ばせず、はみ出すと footer が切れるため。
    VStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          header
          intro
          qrSection
          remoteSection
        }
        .padding(.horizontal, 22)
        .padding(.top, 22)
        .padding(.bottom, 16)
      }

      Rectangle().fill(Theme.border).frame(height: 1)
      footer
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
    }
    .background(Theme.bg)
    .preferredColorScheme(.dark)
  }

  // MARK: - sections

  private var header: some View {
    HStack(spacing: 12) {
      FlowerLogo(color: Theme.accent, size: 18)
      Text("Welcome to Vigili")
        .font(.display(18, weight: .semibold))
        .foregroundStyle(Theme.fg)
    }
  }

  private var intro: some View {
    VStack(alignment: .leading, spacing: 10) {
      bullet(
        "Claude Code がツール承認を求めるたびに、ローカルポリシーが allow/deny/ask を分類。",
      )
      bullet(
        "「人間が判断すべき」だけ手元の iPhone に飛ぶ。2 タップで承認。",
      )
      bullet(
        "デフォルトで使えるポリシーは ~/.vigili/policy.yaml に書き出しました。",
      )
    }
  }

  private func bullet(_ text: String) -> some View {
    HStack(alignment: .top, spacing: 8) {
      Text("·")
        .font(.system(size: 14, weight: .bold))
        .foregroundStyle(Theme.accent)
      Text(text)
        .font(.system(size: 12))
        .foregroundStyle(Theme.fgMid)
        .lineSpacing(2)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  private var qrSection: some View {
    let payload = SetupPayload.compute()
    return VStack(alignment: .leading, spacing: 10) {
      Text("CONNECT YOUR PHONE")
        .font(.mono(9, weight: .semibold))
        .tracking(0.12 * 9)
        .foregroundStyle(Theme.fgDim)

      HStack(spacing: 16) {
        // QR
        if let payload = payload, let qr = qrImage(for: payload.url, size: 118) {
          Image(nsImage: qr)
            .resizable()
            .interpolation(.none)
            .frame(width: 118, height: 118)
            .padding(8)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        } else {
          // token / IP がまだ取れない場合のプレースホルダ
          RoundedRectangle(cornerRadius: 12)
            .fill(Theme.bgRise)
            .frame(width: 118, height: 118)
            .overlay(
              VStack(spacing: 6) {
                ProgressView().controlSize(.small)
                Text("preparing…")
                  .font(.mono(9))
                  .foregroundStyle(Theme.fgDim)
              }
            )
        }

        // 右側ガイド
        VStack(alignment: .leading, spacing: 8) {
          Text("iPhone の Camera.app でこの QR を読み取ると、Vigili モバイル app が起動して接続まで自動で進みます。")
            .font(.system(size: 11))
            .foregroundStyle(Theme.fgMid)
            .fixedSize(horizontal: false, vertical: true)
          if let p = payload {
            Text(p.url)
              .font(.mono(9))
              .foregroundStyle(Theme.fgDim)
              .lineLimit(2)
              .truncationMode(.middle)
              .textSelection(.enabled)
          } else {
            Text("daemon の token / LAN IP を待っています…")
              .font(.mono(9))
              .foregroundStyle(Theme.fgDim)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
  }

  private var footer: some View {
    HStack(spacing: 10) {
      Button(action: { coordinator.connectToClaudeCode() }) {
        HStack(spacing: 4) {
          Image(systemName: coordinator.hookInstalled ? "checkmark.circle.fill" : "link")
            .font(.system(size: 10))
          Text(coordinator.hookInstalled ? "Claude Code 接続済み" : "Claude Code に接続")
            .font(.system(size: 11, weight: .medium))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Capsule().stroke(Theme.border, lineWidth: 1))
        .foregroundStyle(coordinator.hookInstalled ? Theme.green : Theme.fg)
      }
      .buttonStyle(.plain)

      if let s = coordinator.connectStatus {
        Text(s)
          .font(.system(size: 9))
          .foregroundStyle(Theme.fgDim)
          .lineLimit(2)
      }

      Spacer()

      Button(action: { coordinator.dismissWelcome() }) {
        Text("Got it")
          .font(.system(size: 12, weight: .semibold))
          .padding(.horizontal, 14)
          .padding(.vertical, 6)
          .background(Capsule().fill(Theme.accent))
          .foregroundStyle(.white)
      }
      .buttonStyle(.plain)
    }
  }

  /// 外出先用 relay ペアリングのステータスとセットアップ案内。
  @ViewBuilder
  private var remoteSection: some View {
    let hasRelay = SetupPayload.relayConfigured() || coordinator.relayConfigured
    HStack(alignment: .top, spacing: 10) {
      Image(systemName: hasRelay ? "checkmark.circle.fill" : "antenna.radiowaves.left.and.right")
        .font(.system(size: 13))
        .foregroundStyle(hasRelay ? Theme.green : Theme.fgMid)
        .padding(.top, 1)

      VStack(alignment: .leading, spacing: 5) {
        if hasRelay {
          Text("サインイン済み — 外出先でも使えます")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Theme.green)
          Text("この Mac は Apple アカウントにリンクされ、relay に接続済みです。同じ Apple ID で iPhone にサインインすればペアリング完了。Wi-Fi 外でもスマホに承認が届きます。")
            .font(.system(size: 10))
            .foregroundStyle(Theme.fgDim)
            .fixedSize(horizontal: false, vertical: true)
        } else {
          Text("外出先でも使う（任意）")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Theme.fg)
          Text("Sign in with Apple すると、この Mac が relay に接続され、Wi-Fi 外でもスマホに承認が届きます。ターミナルも QR も不要です。")
            .font(.system(size: 10))
            .foregroundStyle(Theme.fgDim)
            .fixedSize(horizontal: false, vertical: true)
          Button(action: { coordinator.signInWithAppleAndPair() }) {
            HStack(spacing: 5) {
              Image(systemName: "apple.logo").font(.system(size: 10))
              Text("Sign in with Apple").font(.system(size: 10, weight: .semibold))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(Theme.fg))
            .foregroundStyle(Theme.bg)
          }
          .buttonStyle(.plain)
          .padding(.top, 2)
          if let s = coordinator.signInStatus {
            Text(s)
              .font(.system(size: 9))
              .foregroundStyle(Theme.fgDim)
          }
        }
      }
      Spacer()
    }
    .padding(10)
    .background(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
  }

  private func copyPairCommand() {
    let pb = NSPasteboard.general
    pb.clearContents()
    pb.setString("vigili-cli pair --relay https://relay.vigili.io", forType: .string)
  }

  private func openTerminal() {
    let script = "tell application \"Terminal\" to activate"
    if let app = NSAppleScript(source: script) {
      var err: NSDictionary?
      app.executeAndReturnError(&err)
    }
  }
}

// MARK: - QR

/// `CIQRCodeGenerator` で QR を生成して NSImage に焼く。
/// `CIFilter.qrCodeGenerator()` は iOS / Mac 共通。
func qrImage(for string: String, size: CGFloat) -> NSImage? {
  guard let data = string.data(using: .utf8) else { return nil }
  let filter = CIFilter.qrCodeGenerator()
  filter.message = data
  filter.correctionLevel = "M"
  guard let ciImage = filter.outputImage else { return nil }
  // 元解像度は 25x25 程度なので、ピクセルそのまま拡大して .none で nearest-neighbor 描画する。
  let scale = size / ciImage.extent.width
  let scaled = ciImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
  let context = CIContext()
  guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
  return NSImage(cgImage: cgImage, size: NSSize(width: size, height: size))
}

// MARK: - Setup payload (LAN IP + token)

struct SetupPayload {
  let host: String      // 例: "192.168.1.5:7878"
  let token: String
  let relay: RelayCreds?
  let url: String       // unified: vigili://setup?u=&t=[&r=&p=&k=]

  struct RelayCreds {
    let url: String
    let pairingId: String
    let userToken: String
  }

  /// 同期で叩いて返す。token / LAN IP が揃わなければ nil。
  /// relay の credentials が ~/.vigili/config.yaml + ~/.vigili/relay-user-token に
  /// あればそれも QR に同梱する (unified)。
  static func compute() -> SetupPayload? {
    let token = DaemonWsClient.macHomeToken()
    guard !token.isEmpty else { return nil }
    guard let ip = detectLanIp() else { return nil }
    let host = "\(ip):7878"

    var qAllowed = CharacterSet.urlQueryAllowed
    qAllowed.remove(charactersIn: "+&=")
    @inline(__always) func enc(_ s: String) -> String {
      s.addingPercentEncoding(withAllowedCharacters: qAllowed) ?? s
    }

    let relay = readRelayCreds()
    var qs = "u=\(enc(host))&t=\(enc(token))"
    if let r = relay {
      qs += "&r=\(enc(r.url))&p=\(enc(r.pairingId))&k=\(enc(r.userToken))"
    }
    let url = "vigili://setup?\(qs)"
    return SetupPayload(host: host, token: token, relay: relay, url: url)
  }

  /// Welcome 画面で「外出先でも使えるか」を即時判定する軽量チェック。
  static func relayConfigured() -> Bool {
    return readRelayCreds() != nil
  }

  /// ~/.vigili/config.yaml の `relay:` 節と ~/.vigili/relay-user-token から
  /// 完全な relay credentials を読み出す。3 点揃わない場合は nil。
  static func readRelayCreds() -> RelayCreds? {
    let home = ("~/.vigili" as NSString).expandingTildeInPath
    let configPath = "\(home)/config.yaml"
    let userTokenPath = "\(home)/relay-user-token"
    guard let yaml = try? String(contentsOfFile: configPath, encoding: .utf8) else { return nil }
    let url = matchYamlScalar(yaml, key: "url", under: "relay:") ?? ""
    let pid = matchYamlScalar(yaml, key: "pairing_id", under: "relay:") ?? ""
    let token = (try? String(contentsOfFile: userTokenPath, encoding: .utf8))?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !url.isEmpty, !pid.isEmpty, !token.isEmpty else { return nil }
    return RelayCreds(url: url, pairingId: pid, userToken: token)
  }

  /// YAML から `<section>:\n  <key>: <value>` 形式の scalar を抜き出す簡易パーサ。
  /// YAML ライブラリを Swift で持ち込まないために最低限の実装。
  private static func matchYamlScalar(_ yaml: String, key: String, under section: String) -> String? {
    let lines = yaml.split(separator: "\n", omittingEmptySubsequences: false)
    var inSection = false
    for raw in lines {
      let line = String(raw)
      if line.hasPrefix(section) {
        inSection = true
        continue
      }
      if inSection {
        // セクション抜け検出 (新しい top-level 行)
        if !line.hasPrefix(" ") && !line.hasPrefix("\t") && !line.isEmpty && !line.hasPrefix("#") {
          inSection = false
          continue
        }
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("\(key):") {
          let after = String(trimmed.dropFirst(key.count + 1))
            .trimmingCharacters(in: .whitespaces)
          // 引用符を剥がす
          var value = after
          if (value.hasPrefix("\"") && value.hasSuffix("\""))
            || (value.hasPrefix("'") && value.hasSuffix("'"))
          {
            value = String(value.dropFirst().dropLast())
          }
          return value
        }
      }
    }
    return nil
  }

  /// `ipconfig getifaddr <iface>` を順に試して最初に取れた IP を返す。
  /// App Sandbox はオフなので Process を直接叩ける。
  /// loopback / link-local / 169.254. は ipconfig が elide してくれる。
  static func detectLanIp() -> String? {
    for iface in ["en0", "en1", "en2", "en3"] {
      if let addr = runIpconfig(iface: iface), !addr.isEmpty, !addr.hasPrefix("169.254.") {
        return addr
      }
    }
    return nil
  }

  private static func runIpconfig(iface: String) -> String? {
    let task = Process()
    task.launchPath = "/usr/sbin/ipconfig"
    task.arguments = ["getifaddr", iface]
    let pipe = Pipe()
    task.standardOutput = pipe
    task.standardError = Pipe()
    do {
      try task.run()
    } catch {
      return nil
    }
    task.waitUntilExit()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    let out = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
    if task.terminationStatus != 0 { return nil }
    return out
  }
}
