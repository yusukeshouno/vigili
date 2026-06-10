import Charts
import SwiftUI

/// メニューバーアイコンクリックで出るポップオーバーの中身。
///
/// PWA の Claude Stack デザインに揃えてある:
///  - 背景: `Theme.bg` (#262624)
///  - サーフェス: `Theme.bgRise` (#2d2b29) + warm cream ボーダー
///  - アクセント: `Theme.accent` (#c16141)
///  - 見出し: Bricolage Grotesque、コードは JetBrains Mono
struct PopoverContentView: View {
  @EnvironmentObject private var coordinator: AppCoordinator
  @State private var showPairingQR = false
  @State private var showPolicy = false
  /// pending バッジを叩くためのフラグ
  @State private var badgePop = false
  /// 決定時のカード飛び出し (PWA SwipeStack 風)。allow=右 / deny=左へ真っ直ぐ。
  @State private var flyingOut: FlyOut? = nil
  /// 多重発火ガード (飛び出しアニメ中は次の決定を受け付けない)。
  @State private var deciding = false

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
    .onAppear { maybeShowWizard() }
    // Welcome を「Got it」で閉じた直後 (showWelcome: true→false) にもウィザードを出す。
    // onAppear は初回オープン時 showWelcome=true でガードに弾かれ再発火しないため、
    // 遷移を onChange で拾わないと新規インストールでウィザードが一度も出ない。
    .onChange(of: coordinator.showWelcome) { isWelcome in
      if !isWelcome { maybeShowWizard() }
    }
  }

  /// ウィザード未完了かつ Welcome 非表示なら、少し遅らせて 1 度だけ開く。
  private func maybeShowWizard() {
    guard !coordinator.showWelcome, !onboardingComplete else { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
      // 遅延中に状態が変わっていないか再確認 (二重表示防止)。
      guard !coordinator.showWelcome, !onboardingComplete else { return }
      OnboardingWindow.show(coordinator: coordinator) { _ in
        onboardingComplete = true
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
    let topCard = coordinator.pending.newestFirst.first
    return VStack(spacing: 8) {
      // 主操作: Deny / Allow
      HStack(spacing: 10) {
        PillButton(
          label: "Deny",
          icon: "xmark",
          style: .ghost,
          action: {
            if let card = topCard {
              performDecision(card: card, verdict: "deny")
            }
          }
        )
        PillButton(
          label: "Allow",
          icon: "checkmark",
          style: .primary,
          action: {
            if let card = topCard {
              performDecision(card: card, verdict: "allow")
            }
          }
        )
      }

      // 副操作: 今後は自動で承認 (promote to rule)
      // 危険操作 (.danger) は自動承認させない: 誤って常時 allow ルール化すると
      // 取り返しがつかないため。ボタンを消し、理由を 1 行で示す。
      if let card = topCard, !RiskAssessment.evaluate(card).allowsAutoApprove {
        HStack(spacing: 5) {
          Image(systemName: "lock.fill")
            .font(.system(size: 9))
          Text("危険操作のため自動承認は無効")
            .font(.mono(9))
        }
        .foregroundStyle(Theme.fgDim)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 11)
      } else {
        // 確認ダイアログは出さない: MenuBarExtra(.window) の popover では alert を出すと
        // popover がフォーカスを失って閉じてしまい、ダイアログに気づけない。
        // 誤爆してもルールは 24h で失効し「ポリシー」画面から即削除できるので直接実行する。
        Button {
          if let card = topCard {
            performDecision(card: card, verdict: "allow", promote: true)
          }
        } label: {
          HStack(spacing: 7) {
            Image(systemName: "arrow.up.circle.fill")
              .font(.system(size: 14))
            Text("今後は自動で承認")
              .font(.mono(12, weight: .medium))
          }
          .foregroundStyle(Theme.fgMid)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 13)
          .background(
            RoundedRectangle(cornerRadius: 10)
              .stroke(Theme.borderStrong, lineWidth: 1)
          )
          .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
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
            // バッジが出るとき / 数字が変わるとき: 大きく弾ける pop アニメーション
            .scaleEffect(badgePop ? 1.0 : 0.2)
            .rotationEffect(.degrees(badgePop ? 0 : -28))
            .animation(
              .spring(response: 0.32, dampingFraction: 0.38),
              value: badgePop
            )
            .onChange(of: coordinator.pendingCount) { _ in
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
      // 接続中: 脈動する緑ドット + 大きく広がる波紋リング (timer 駆動)
      ConnectedPulseDot()
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
    // 急に切り替わると違和感があるので、ゆっくりした ease-out で浮かび上がらせる。
    .animation(.easeOut(duration: 0.6), value: coordinator.pending.isEmpty)
  }

  private var emptyState: some View {
    VStack(spacing: 0) {
      // Spacer でレーダーを統計ストリップとの間で垂直中央に浮かせる
      Spacer(minLength: 0)
      StandingWatchView(wsState: coordinator.wsState, radarSize: 180)
        .transition(.opacity)
      Spacer(minLength: 0)

      // 統計ストリップは常に下端に固定
      if coordinator.todayStats != nil || !coordinator.weekStats.isEmpty {
        MacStatsStrip(
          stats: coordinator.todayStats,
          week: coordinator.weekStats
        )
        .padding(.top, 8)
      }
    }
  }

  private var cardList: some View {
    // ボタンは popover 底の actionsBar に統一。
    // top card (最新) を強調、それ以下は沈めてスタック感を演出。
    let sorted = coordinator.pending.newestFirst
    return ScrollView {
      VStack(spacing: 12) {
        ForEach(Array(sorted.enumerated()), id: \.element.id) { idx, req in
          ApprovalCard(request: req)
            .opacity(cardOpacity(idx: idx, id: req.id))
            .scaleEffect(cardScale(idx: idx, id: req.id))
            .offset(
              x: cardOffsetX(idx: idx, id: req.id),
              y: cardOffsetY(idx: idx, id: req.id)
            )
            .zIndex(Double(sorted.count - idx))
            .transition(
              .asymmetric(
                insertion: .scale(scale: 0.62, anchor: .top)
                  .combined(with: .opacity)
                  .combined(with: .offset(y: -14))
                  .animation(.spring(response: 0.46, dampingFraction: 0.52)),
                // 飛び出しは state 駆動で済ませているので、除去自体は素早いフェードのみ。
                removal: .opacity.animation(.easeOut(duration: 0.12))
              )
            )
        }
      }
      .padding(.vertical, 4)
      .animation(.spring(response: 0.42, dampingFraction: 0.56), value: coordinator.pending.count)
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

      // ホスト型セッション (vigili run): 会話 + 質問/plan 回答 + 返信
      Button {
        SessionsWindow.show(coordinator: coordinator)
      } label: {
        ZStack(alignment: .topTrailing) {
          Image(systemName: "bubble.left.and.bubble.right")
            .font(.system(size: 12))
            .foregroundStyle(coordinator.sessions.isEmpty ? Theme.fgMid : Theme.fg)
          if sessionsNeedAttention {
            Circle()
              .fill(Theme.accent)
              .frame(width: 6, height: 6)
              .offset(x: 4, y: -3)
          }
        }
      }
      .buttonStyle(.plain)
      .help("Hosted sessions (vigili run)")

      // Sign in with Apple → 独立ウィンドウを開いてから認証
      // (popover 内から ASAuthorizationController を出すと popover が閉じるため)
      Button {
        SignInWindow.show(coordinator: coordinator)
      } label: {
        Image(systemName: "applelogo")
          .font(.system(size: 12))
          .foregroundStyle(Theme.fgMid)
      }
      .buttonStyle(.plain)
      .help("Sign in with Apple — iPhone と自動リンク (QR 不要)")

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

  // MARK: - decision fly-out (PWA SwipeStack 風)

  /// PWA の SwipeStack と同じ要領で、top カードを承認=右 / 拒否=左へ飛ばしてから
  /// 実際の decision をコミットする。データ削除より先にカード view 自体を
  /// アニメさせるので、**最後の 1 枚でも必ず exit アニメが出る**
  /// (空状態への切り替えで transition が飛ばされる問題を回避)。
  private func performDecision(card: ApprovalRequest, verdict: String, promote: Bool = false) {
    guard !deciding else { return }
    deciding = true

    // allow=右 / deny=左へ真っ直ぐ飛ばす (バウンス付き spring で launch)
    withAnimation(.spring(response: 0.40, dampingFraction: 0.58)) {
      flyingOut = FlyOut(id: card.id, verdict: verdict)
    }
    // 飛び切ったら実データを削除。残カード / 空状態はバウンスで繰り上げる。
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.34) {
      withAnimation(.spring(response: 0.50, dampingFraction: 0.56)) {
        if promote {
          coordinator.decideAndPromote(id: card.id, request: card)
        } else {
          coordinator.decide(id: card.id, decision: verdict)
        }
      }
      flyingOut = nil
      deciding = false
    }
  }

  /// 各カードの transform 値。`flyingOut` 対象なら横へ真っ直ぐ画面外、それ以外は深度スタック。
  private func cardOffsetX(idx: Int, id: String) -> CGFloat {
    if let f = flyingOut, f.id == id {
      return f.verdict == "allow" ? 560 : -560
    }
    return 0
  }

  private func cardOffsetY(idx: Int, id: String) -> CGFloat {
    // 飛び出し中は縦オフセットなし (真っ直ぐ横へ)。それ以外は深度スタック。
    if flyingOut?.id == id { return 0 }
    return idx == 0 ? 0 : CGFloat(idx) * -5
  }

  private func cardScale(idx: Int, id: String) -> CGFloat {
    if flyingOut?.id == id { return 0.82 }
    return idx == 0 ? 1.0 : max(0.92, 1.0 - CGFloat(idx) * 0.03)
  }

  private func cardOpacity(idx: Int, id: String) -> Double {
    if flyingOut?.id == id { return 0 }
    return idx == 0 ? 1.0 : 0.50
  }

  // MARK: - helpers

  /// ホスト型セッションに未回答の質問 / plan があるか (フッターのバッジ点灯用)。
  private var sessionsNeedAttention: Bool {
    !coordinator.pendingQuestions.isEmpty || !coordinator.pendingPlans.isEmpty
  }

  private func openLogs() {
    // ~/.vigili が存在しなければ旧 ~/.sentinel から開く (移行期 fallback)
    let home = FileManager.default.homeDirectoryForCurrentUser
    let vigili = home.appendingPathComponent(".vigili/daemon.log")
    let sentinel = home.appendingPathComponent(".sentinel/daemon.log")
    let url = FileManager.default.fileExists(atPath: vigili.path) ? vigili : sentinel
    NSWorkspace.shared.open(url)
  }
}

// MARK: - Mac コンパクト統計ストリップ

/// ポップオーバーの待機画面 (レーダー下) に出る 1 行 + スパークラインの統計ストリップ。
///
///  Today  47  ↑ +12  ▁▃▅▇▅▃█  (7 日スパークライン)
/// Mac ポップオーバーの可視化ストリップ。
/// デザイン: TODAY (左) ← → 275 DECISIONS (右) / バー / 14 AUTO ■ 158 YOU ■ 103 BLOCKED
private struct MacStatsStrip: View {
  let stats: StatsBuckets?
  let week: [DailyBucket]

  private var total: Int { stats?.total ?? 0 }
  private var humanApproved: Int {
    guard let s = stats else { return 0 }
    return (s.bySource["human-pwa"] ?? 0) + (s.bySource["human-cli"] ?? 0)
  }
  private var autoApproved: Int {
    guard let s = stats else { return 0 }
    return max(0, s.byDecision.allow - humanApproved)
  }
  private var blocked: Int { stats?.byDecision.deny ?? 0 }

  // バーの比率: auto(左) / human(中) / blocked(右)
  private var autoFrac:  CGFloat { total > 0 ? CGFloat(autoApproved) / CGFloat(total) : 0 }
  private var humanFrac: CGFloat { total > 0 ? CGFloat(humanApproved) / CGFloat(total) : 0 }

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      // 行1: TODAY ← → 275 DECISIONS
      HStack(alignment: .firstTextBaseline) {
        Text("TODAY")
          .font(.mono(9, weight: .medium))
          .foregroundStyle(Theme.fgDim)
          .tracking(0.6)
        Spacer()
        HStack(alignment: .firstTextBaseline, spacing: 3) {
          Text("\(total)")
            .font(.system(size: 15, weight: .bold, design: .rounded))
            .foregroundStyle(Theme.fg)
            .contentTransition(.numericText())
          Text("DECISIONS")
            .font(.mono(8))
            .foregroundStyle(Theme.fgDim)
            .tracking(0.5)
        }
      }

      // 行2: セグメントバー (auto / human / blocked)
      GeometryReader { geo in
        HStack(spacing: 2) {
          // auto セグメント (sage green)
          RoundedRectangle(cornerRadius: 2)
            .fill(Theme.green)
            .frame(width: max(2, geo.size.width * autoFrac))
          // human セグメント (coral)
          RoundedRectangle(cornerRadius: 2)
            .fill(Theme.accent)
            .frame(width: max(2, geo.size.width * humanFrac))
          // blocked セグメント (dim)
          RoundedRectangle(cornerRadius: 2)
            .fill(Theme.fgFaint.opacity(0.4))
            .frame(maxWidth: .infinity)
        }
      }
      .frame(height: 5)

      // 行3: 14 AUTO ■ 158 YOU ■ 103 BLOCKED
      HStack(spacing: 10) {
        legendItem(value: autoApproved,   label: "AUTO",    color: Theme.green)
        legendItem(value: humanApproved,  label: "YOU",     color: Theme.accent)
        legendItem(value: blocked,        label: "BLOCKED", color: Theme.fgFaint.opacity(0.4))
        Spacer()
      }
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 8)
    .background(RoundedRectangle(cornerRadius: 6).fill(Theme.bgRise))
    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Theme.border, lineWidth: 0.5))
  }

  private func legendItem(value: Int, label: String, color: Color) -> some View {
    HStack(spacing: 4) {
      RoundedRectangle(cornerRadius: 1.5)
        .fill(color)
        .frame(width: 8, height: 8)
      Text("\(value)")
        .font(.mono(9, weight: .semibold))
        .foregroundStyle(Theme.fg)
      Text(label)
        .font(.mono(9))
        .foregroundStyle(Theme.fgDim)
    }
  }
}

/// 決定時に飛んでいくカードの識別子と方向。
private struct FlyOut: Equatable {
  let id: String
  /// "allow" → 右へ / "deny" → 左へ。
  let verdict: String
}

/// 接続中インジケータ: 脈動する緑コアドット + 外へ広がる波紋リング。
///
/// `MenuBarExtra(.window)` のポップオーバー内では `.repeatForever()` が tick しないため、
/// `Timer.publish(... in: .common)` を main run loop に流して毎フレーム再評価する。
private struct ConnectedPulseDot: View {
  private let ticker = Timer.publish(every: 1.0 / 60.0, on: .main, in: .common).autoconnect()
  @State private var now = Date()

  var body: some View {
    let t = now.timeIntervalSinceReferenceDate

    // 波紋: 1.5s 周期で 7 → 30pt に広がりながらフェード
    let ripplePeriod = 1.5
    let rp = t.truncatingRemainder(dividingBy: ripplePeriod) / ripplePeriod  // 0..1
    let rippleSize = 7 + 23 * rp
    let rippleOpacity = 0.75 * (1 - rp)

    // コアドット: 0.9s 周期で sin 脈動
    let pulsePeriod = 0.9
    let pp = t.truncatingRemainder(dividingBy: pulsePeriod) / pulsePeriod
    let s = sin(pp * .pi * 2)            // -1..1
    let coreScale = 1.05 + 0.25 * s      // 0.8..1.3
    let glow = 0.3 + 0.3 * (0.5 + 0.5 * s)

    return ZStack {
      Circle()
        .stroke(Theme.green.opacity(rippleOpacity), lineWidth: 2)
        .frame(width: rippleSize, height: rippleSize)
      Circle()
        .fill(Theme.green)
        .frame(width: 7, height: 7)
        .scaleEffect(coreScale)
        .shadow(color: Theme.green.opacity(glow), radius: 4)
    }
    .frame(width: 30, height: 30)
    .onReceive(ticker) { now = $0 }
  }
}
