import SwiftUI

/// メニューバーアイコンクリックで出るポップオーバーの中身。
///
/// PWA の Claude Stack デザインに揃えてある:
///  - 背景: `Theme.bg` (#262624)
///  - サーフェス: `Theme.bgRise` (#2d2b29) + warm cream ボーダー
///  - アクセント: `Theme.accent` (#c96442)
///  - 見出し: Bricolage Grotesque、コードは JetBrains Mono
struct PopoverContentView: View {
  @EnvironmentObject private var coordinator: AppCoordinator
  @State private var showPairingQR = false
  @State private var showPolicy = false
  @State private var promoteConfirmTarget: ApprovalRequest? = nil
  /// pending バッジを叩くためのフラグ
  @State private var badgePop = false
  /// 接続ドット波紋
  @State private var dotRipple = false

  /// 初回起動時にウィザードを 1 度だけ表示するためのフラグ。
  @AppStorage("vigili.onboardingComplete") private var onboardingComplete = false

  var body: some View {
    Group {
      if coordinator.showWelcome {
        WelcomeView()
      } else {
        mainContent
      }
    }
    .onAppear {
      // ペアリング完了済みでまだウィザードを通っていない場合に自動表示
      if !coordinator.showWelcome && !onboardingComplete {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
          OnboardingWindow.show(coordinator: coordinator) { _ in
            onboardingComplete = true
          }
        }
      }
    }
  }

  private var mainContent: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      divider
      Spacer(minLength: 14)
      placeholder
      Spacer(minLength: 12)
      if coordinator.pending.isEmpty {
        divider
        footer
      } else {
        actionsBar
        Spacer(minLength: 12)
        divider
        footer
      }
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 16)
    .background(Theme.bg)
    .preferredColorScheme(.dark)
  }

  /// pending がある時、popover 底に固定で出る Allow / Deny / Always allow。
  /// 必ず一番上のカード (最新の ask) に対して効く。
  /// SwipeStack の "top card のみ操作可" メタファを継承。
  private var actionsBar: some View {
    let topCard = coordinator.pending.sorted(by: { $0.createdAt > $1.createdAt }).first
    return VStack(spacing: 8) {
      // 主操作: Deny / Allow
      HStack(spacing: 10) {
        PillButton(
          label: "Deny",
          icon: "xmark",
          style: .ghost,
          action: {
            if let id = topCard?.id {
              coordinator.decide(id: id, decision: "deny")
            }
          }
        )
        PillButton(
          label: "Allow",
          icon: "checkmark",
          style: .primary,
          action: {
            if let id = topCard?.id {
              coordinator.decide(id: id, decision: "allow")
            }
          }
        )
      }

      // 副操作: 今後は自動で承認 (promote to rule)
      Button {
        if let card = topCard {
          promoteConfirmTarget = card
        }
      } label: {
        HStack(spacing: 5) {
          Image(systemName: "arrow.up.circle")
            .font(.system(size: 10))
          Text("今後は自動で承認")
            .font(.mono(10))
        }
        .foregroundStyle(Theme.fgDim)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(
          RoundedRectangle(cornerRadius: 8)
            .stroke(Theme.border, lineWidth: 1)
        )
      }
      .buttonStyle(.plain)
      .alert(
        "ルールを作成しますか？",
        isPresented: Binding(
          get: { promoteConfirmTarget != nil },
          set: { if !$0 { promoteConfirmTarget = nil } }
        ),
        presenting: promoteConfirmTarget
      ) { card in
        Button("作成して承認", role: .none) {
          coordinator.decideAndPromote(id: card.id, request: card)
          promoteConfirmTarget = nil
        }
        Button("キャンセル", role: .cancel) {
          promoteConfirmTarget = nil
        }
      } message: { card in
        let payload = card.buildPromotePayload()
        let match = payload["match"] as? [String: Any]
        let scopeNote = (match?["repo_in"] as? [String])?.first.map { "プロジェクト「\($0)」限定" }
          ?? "全プロジェクト共通"
        Text("このリクエストと同じパターンを今後は自動で承認するルールを作成します。\n\n範囲: \(scopeNote)\n有効期間: 24時間\n\n不要になったら「ポリシー」画面から削除できます。")
      }
    }
    .padding(.vertical, 12)
    .disabled(topCard == nil)
  }

  // MARK: - sections

  private var divider: some View {
    Rectangle()
      .fill(Theme.border)
      .frame(height: 1)
      .padding(.horizontal, -18)  // popover の左右端まで伸ばす
  }

  private var header: some View {
    HStack(spacing: 12) {
      FlowerLogo(
        color: coordinator.pendingCount > 0 ? Theme.accent : Theme.fgMid,
        size: 16
      )
      HStack(spacing: 8) {
        Text("Vigili")
          .font(.display(16, weight: .semibold))
          .foregroundStyle(Theme.fg)
        if coordinator.pendingCount > 0 {
          Text("\(coordinator.pendingCount) PENDING")
            .font(.mono(9, weight: .semibold))
            .tracking(0.12 * 9)
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
              Capsule()
                .fill(Theme.accent.opacity(0.1))
                .overlay(Capsule().stroke(Theme.accent.opacity(0.5), lineWidth: 0.5))
            )
            // バッジが出るとき / 数字が変わるとき: pop アニメーション
            .scaleEffect(badgePop ? 1.0 : 0.4)
            .rotationEffect(.degrees(badgePop ? 0 : -15))
            .animation(
              .spring(response: 0.26, dampingFraction: 0.46),
              value: badgePop
            )
            .onChange(of: coordinator.pendingCount) { _, _ in
              badgePop = false
              withAnimation { badgePop = true }
            }
            .onAppear { badgePop = true }
            .id(coordinator.pendingCount)
        }
      }
      Spacer()
      daemonStatusBadge
    }
    .padding(.bottom, 12)
  }

  /// ヘッダー右肩のステータスインジケータ。
  @ViewBuilder
  private var daemonStatusBadge: some View {
    if case .connected = coordinator.wsState {
      // 接続中: 緑ドット + 波紋リング
      ZStack {
        Circle()
          .stroke(Theme.green.opacity(dotRipple ? 0 : 0.6), lineWidth: 1.5)
          .frame(width: dotRipple ? 22 : 7, height: dotRipple ? 22 : 7)
          .animation(
            .easeOut(duration: 1.6).repeatForever(autoreverses: false),
            value: dotRipple
          )
        Circle()
          .fill(Theme.green)
          .frame(width: 7, height: 7)
      }
      .onAppear { dotRipple = true }
    } else if case .crashed(_, _) = coordinator.daemonStatus {
      // クラッシュ: 赤ドット + テキスト
      HStack(spacing: 4) {
        Circle()
          .fill(Theme.red)
          .frame(width: 7, height: 7)
        Text("daemon down")
          .font(.mono(9))
          .foregroundStyle(Theme.red)
      }
    } else if case .stopped = coordinator.daemonStatus {
      // 停止中: 暗いドットのみ (テキストなし)
      Circle()
        .fill(Theme.fgDim)
        .frame(width: 7, height: 7)
    }
    // .starting は何も表示しない (一瞬なので)
  }

  private var placeholder: some View {
    Group {
      if coordinator.pending.isEmpty {
        emptyState
      } else {
        cardList
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.top, 8)
  }

  private var emptyState: some View {
    StandingWatchView(wsState: coordinator.wsState)
      .padding(.vertical, 24)
  }

  private var cardList: some View {
    // ボタンは popover 底の actionsBar に統一。
    // top card (最新) を強調、それ以下は沈めてスタック感を演出。
    let sorted = coordinator.pending.sorted(by: { $0.createdAt > $1.createdAt })
    return ScrollView {
      VStack(spacing: 12) {
        ForEach(Array(sorted.enumerated()), id: \.element.id) { idx, req in
          ApprovalCard(request: req)
            .opacity(idx == 0 ? 1.0 : 0.50)
            .scaleEffect(
              x: idx == 0 ? 1.0 : max(0.92, 1.0 - Double(idx) * 0.03),
              y: idx == 0 ? 1.0 : max(0.92, 1.0 - Double(idx) * 0.03)
            )
            .offset(y: idx == 0 ? 0 : CGFloat(idx) * -5)
            .zIndex(Double(sorted.count - idx))
            .transition(
              .asymmetric(
                insertion: .scale(scale: 0.82, anchor: .top)
                  .combined(with: .opacity)
                  .animation(.spring(response: 0.42, dampingFraction: 0.58)),
                removal: .scale(scale: 0.88)
                  .combined(with: .opacity)
                  .animation(.spring(response: 0.28, dampingFraction: 0.7))
              )
            )
        }
      }
      .padding(.vertical, 4)
      .animation(.spring(response: 0.38, dampingFraction: 0.68), value: coordinator.pending.count)
    }
    .frame(maxHeight: 380)
  }

  private var footer: some View {
    HStack(spacing: 6) {
      Button {
        coordinator.daemonController.restart()
      } label: {
        HStack(spacing: 6) {
          Image(systemName: "arrow.clockwise")
            .font(.system(size: 10))
          Text("Restart daemon")
            .font(.mono(10))
        }
        .foregroundStyle(Theme.fgMid)
      }
      .buttonStyle(.plain)

      Spacer()

      // iPhone ペアリング QR を再表示
      Button {
        showPairingQR = true
      } label: {
        Image(systemName: "qrcode")
          .font(.system(size: 12))
          .foregroundStyle(Theme.fgMid)
      }
      .buttonStyle(.plain)
      .help("Show pairing QR for iPhone")
      .popover(isPresented: $showPairingQR, arrowEdge: .bottom) {
        PairingQRPopover()
      }

      // ポリシールール & 自動処理履歴
      Button {
        showPolicy = true
      } label: {
        Image(systemName: "shield.lefthalf.filled")
          .font(.system(size: 12))
          .foregroundStyle(Theme.fgMid)
      }
      .buttonStyle(.plain)
      .help("Auto-processing rules & history")
      .popover(isPresented: $showPolicy, arrowEdge: .bottom) {
        PolicyView()
          .environmentObject(coordinator)
      }

      Button {
        openLogs()
      } label: {
        Image(systemName: "doc.text")
          .font(.system(size: 12))
          .foregroundStyle(Theme.fgMid)
      }
      .buttonStyle(.plain)
      .help("View daemon log")

      Button {
        NSApp.terminate(nil)
      } label: {
        Image(systemName: "power")
          .font(.system(size: 12))
          .foregroundStyle(Theme.fgMid)
      }
      .buttonStyle(.plain)
      .help("Quit Vigili")
    }
    .padding(.top, 12)
  }

  // MARK: - helpers

  private func openLogs() {
    // ~/.vigili が存在しなければ旧 ~/.sentinel から開く (移行期 fallback)
    let home = FileManager.default.homeDirectoryForCurrentUser
    let vigili = home.appendingPathComponent(".vigili/daemon.log")
    let sentinel = home.appendingPathComponent(".sentinel/daemon.log")
    let url = FileManager.default.fileExists(atPath: vigili.path) ? vigili : sentinel
    NSWorkspace.shared.open(url)
  }
}
