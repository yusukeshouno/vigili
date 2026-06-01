import AppKit
import Combine
import Foundation
import SwiftUI
#if canImport(WidgetKit)
  import WidgetKit
#endif

// appLog は Sources/Shared/AppLog.swift で共通定義。

/// アプリ全体の状態を 1 か所に集約する ObservableObject。
///
/// 役割:
/// - daemon の子プロセス管理 (`DaemonController`)
/// - admin プロトコル経由の pending / stats ポーリング
/// - SwiftUI 側からは `@EnvironmentObject` で参照する
///
/// シングルトン的に扱うため `.shared` を公開し、AppDelegate からも触れるようにする。
@MainActor
final class AppCoordinator: ObservableObject {
  static weak var shared: AppCoordinator?

  let daemonController: DaemonController
  let adminClient: DaemonAdminClient
  let wsClient: DaemonWsClient

  // 表示用に publish するもの
  @Published var pendingCount: Int = 0
  @Published var pending: [ApprovalRequest] = []
  @Published var messages: [Message] = []
  @Published var todayStats: StatsBuckets?
  /// 直近 7 日の日別バケット (index 0=今日)。WS 経由で取得。
  @Published var weekStats: [DailyBucket] = []
  @Published var daemonStatus: DaemonController.Status = .stopped
  @Published var wsState: DaemonWsClient.State = .disconnected
  @Published var lastError: String?

  // --- L4 ホスト型セッション (vigili run) ---
  @Published var sessions: [HostedSession] = []
  @Published var transcripts: [String: [TranscriptLine]] = [:]
  @Published var pendingQuestions: [PendingQuestion] = []
  @Published var pendingPlans: [PendingPlan] = []

  /// 初回起動時に Welcome 画面を出すかどうか。`~/.vigili/.welcomed` の有無で判定。
  @Published var showWelcome: Bool

  // --- オンボーディング (ターミナル不要) ---
  /// Claude Code hook が ~/.claude/settings.json に導入済みか。
  @Published var hookInstalled: Bool = HookInstaller.isInstalled()
  /// Sign in with Apple で relay 接続が構成済みか。
  @Published var relayConfigured: Bool = false
  /// 「Claude Code に接続」の結果トースト。
  @Published var connectStatus: String?
  /// 「Sign in with Apple」の結果トースト。
  @Published var signInStatus: String?

  private var pollTimer: Timer?
  private var tickCount = 0

  /// 直前に widget へ書き出した state。同じ内容で reloadTimelines を spam しないため。
  private var lastWidgetState: WidgetState?

  /// daemon socket のパス。VIGILI_HOME / SENTINEL_HOME (旧名) で override 可能。
  /// 新規ユーザは ~/.vigili、旧ユーザは ~/.sentinel をそのまま使い続けられる。
  private static func defaultSocketPath() -> String {
    if let env = ProcessInfo.processInfo.environment["VIGILI_HOME"]
        ?? ProcessInfo.processInfo.environment["SENTINEL_HOME"] {
      return "\(env)/daemon.sock"
    }
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let vigili = "\(home)/.vigili"
    let sentinel = "\(home)/.sentinel"
    if FileManager.default.fileExists(atPath: vigili) {
      return "\(vigili)/daemon.sock"
    }
    if FileManager.default.fileExists(atPath: sentinel) {
      return "\(sentinel)/daemon.sock"
    }
    return "\(vigili)/daemon.sock"
  }

  /// Vigili home directory ($VIGILI_HOME or ~/.vigili, fallback ~/.sentinel).
  static func vigiliHome() -> URL {
    if let env = ProcessInfo.processInfo.environment["VIGILI_HOME"]
        ?? ProcessInfo.processInfo.environment["SENTINEL_HOME"] {
      return URL(fileURLWithPath: env, isDirectory: true)
    }
    let home = FileManager.default.homeDirectoryForCurrentUser
    let vigili = home.appendingPathComponent(".vigili", isDirectory: true)
    if FileManager.default.fileExists(atPath: vigili.path) {
      return vigili
    }
    let sentinel = home.appendingPathComponent(".sentinel", isDirectory: true)
    if FileManager.default.fileExists(atPath: sentinel.path) {
      return sentinel
    }
    return vigili
  }

  init() {
    let socketPath = Self.defaultSocketPath()
    self.daemonController = DaemonController()
    self.adminClient = DaemonAdminClient(socketPath: socketPath)
    // Mac は localhost: 7878 に直接繋ぐ。token は ~/.vigili/token から読む。
    self.wsClient = DaemonWsClient(
      urlBase: URL(string: "ws://127.0.0.1:7878")!,
      token: DaemonWsClient.macHomeToken()
    )
    // ~/.vigili/.welcomed (marker file) が無ければ Welcome を出す。
    let welcomedPath = Self.vigiliHome().appendingPathComponent(".welcomed")
    self.showWelcome = !FileManager.default.fileExists(atPath: welcomedPath.path)
    AppCoordinator.shared = self

    appLog("AppCoordinator.init socket=\(socketPath)")

    // daemon の status を UI に反映
    daemonController.$status
      .receive(on: DispatchQueue.main)
      .assign(to: &$daemonStatus)

    // WS から pending を受け取って publish プロパティに反映
    wsClient.$pending
      .receive(on: DispatchQueue.main)
      .sink { [weak self] list in
        guard let self = self else { return }
        self.pending = list
        self.pendingCount = list.count
        self.refreshWidget()
      }
      .store(in: &cancellables)

    wsClient.$state
      .receive(on: DispatchQueue.main)
      .sink { [weak self] state in
        self?.wsState = state
        self?.refreshWidget()
      }
      .store(in: &cancellables)

    // messages を coordinator にも mirror
    wsClient.$messages
      .receive(on: DispatchQueue.main)
      .assign(to: &$messages)

    // 週次バケット (WS stats メッセージ) を mirror
    wsClient.$weekStats
      .receive(on: DispatchQueue.main)
      .assign(to: &$weekStats)

    // L4 ホスト型セッション系も coordinator に mirror
    wsClient.$sessions.receive(on: DispatchQueue.main).assign(to: &$sessions)
    wsClient.$transcripts.receive(on: DispatchQueue.main).assign(to: &$transcripts)
    wsClient.$pendingQuestions.receive(on: DispatchQueue.main).assign(to: &$pendingQuestions)
    wsClient.$pendingPlans.receive(on: DispatchQueue.main).assign(to: &$pendingPlans)

    // 起動
    daemonController.start()
    // daemon の socket / WS が立ち上がるまで少し時間がかかるので 2 秒遅延
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
      self?.wsClient.start()
    }
    startPolling()
    appLog("AppCoordinator.init: ws + polling started")
  }

  private var cancellables = Set<AnyCancellable>()

  /// pending は WS の push が source of truth。
  /// admin プロトコルは 5 秒ごとの stats 取得と、WS 切断時の pending フォールバック用。
  private func startPolling() {
    pollTimer?.invalidate()
    tickCount = 0
    fireTick()
    pollTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
      Task { @MainActor [weak self] in
        self?.fireTick()
      }
    }
    if let t = pollTimer {
      RunLoop.main.add(t, forMode: .common)
    }
    appLog("polling timer scheduled")
  }

  private func fireTick() {
    Task { @MainActor [weak self] in
      guard let self = self else { return }
      // WS が生きていない時だけ pending を admin から取りに行く
      if case .connected = self.wsState {
        // WS が source of truth、ここでは触らない
      } else {
        await self.tickPending()
        // 切断中は積極的に再接続を促す。wsClient 自身の backoff より優先して
        // 5 秒ごとに health probe → 即再接続。widget が stale のまま放置されるのを防ぐ。
        if self.tickCount % 5 == 0 {
          switch self.wsState {
          case .failed, .disconnected:
            self.wsClient.reconnectNow()
          default:
            break  // .connecting 中は触らない (churn 防止)
          }
        }
      }
      if self.tickCount % 5 == 0 {
        await self.tickStats()
      }
      // widget の Allow/Deny ボタンが書いた決定を取り込んで daemon に適用 (毎 tick = 1s)
      self.drainWidgetDecisions()
      self.tickCount &+= 1
    }
  }

  /// PopoverContentView から呼ばれる Allow / Deny。
  func decide(id: String, decision: String) {
    wsClient.decide(id: id, decision: decision)
  }

  /// "今後は自動で承認" ボタンから呼ばれる。
  /// request.buildPromotePayload() でルールを自動生成して allow + promote を送る。
  func decideAndPromote(id: String, request: ApprovalRequest) {
    wsClient.decideWithPromote(id: id, promote: request.buildPromotePayload())
  }

  // --- L4 ホスト型セッションへの回答 ---

  /// AskUserQuestion への回答。
  func answerQuestion(requestId: String, answers: [String: String]) {
    wsClient.answerQuestion(requestId: requestId, answers: answers)
  }

  /// plan (ExitPlanMode) の承認 / 却下。
  func decidePlan(requestId: String, decision: String, reason: String? = nil) {
    wsClient.decidePlan(requestId: requestId, decision: decision, reason: reason)
  }

  /// ホスト型セッションへの自由文返信。
  func sendSessionReply(sessionId: String, body: String) {
    wsClient.sendSessionReply(sessionId: sessionId, body: body)
  }

  // MARK: - widget の Allow/Deny ボタン取り込み

  /// widget の Allow/Deny ボタン (App Intent) が widget コンテナに書いた決定を取り込み、
  /// daemon に適用する。widget はサンドボックスで daemon socket に届かないため、
  /// コンテナファイル経由で受け取る (毎 tick = 1s でドレイン)。
  private func drainWidgetDecisions() {
    let applied = WidgetState.drainDecisions { [weak self] id, decision in
      self?.decide(id: id, decision: decision)
      appLog("widget decision: \(decision) \(id)")
    }
    if applied > 0 {
      appLog("widget decisions drained: \(applied)")
    }
  }

  /// WelcomeView の "Got it" で呼ばれる。marker file を書いて以後出さない。
  func dismissWelcome() {
    let home = Self.vigiliHome()
    // home が無ければ作る (daemon が先に作ってるはずだが念のため)
    if !FileManager.default.fileExists(atPath: home.path) {
      try? FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    }
    let marker = home.appendingPathComponent(".welcomed")
    try? "ok\n".write(to: marker, atomically: true, encoding: .utf8)
    showWelcome = false
  }

  // MARK: - ターミナル不要オンボーディング

  /// 「Claude Code に接続」: PreToolUse hook を ~/.claude/settings.json に冪等導入し daemon を起動。
  func connectToClaudeCode() {
    do {
      let r = try HookInstaller.installIfNeeded()
      hookInstalled = true
      daemonController.start()
      connectStatus = r.alreadyPresent
        ? "既に接続済みです"
        : "hook を導入しました（Claude Code のセッションを開き直してください）"
    } catch {
      connectStatus = "接続に失敗: \(error.localizedDescription)"
    }
    clearConnectStatusSoon()
  }

  /// 「Sign in with Apple」: Apple 認証 → relay session → この Mac の pairing 作成 →
  /// daemon を再起動なしで relay 接続 (relay-configure admin)。
  func signInWithAppleAndPair() {
    Task { @MainActor in
      signInStatus = "サインイン中…"
      do {
        let result = try await AppleSignInCoordinator().signIn()
        let auth = try await RelayAuthClient.signInWithApple(
          identityToken: result.identityToken, rawNonce: result.rawNonce,
        )
        let host = Host.current().localizedName ?? ProcessInfo.processInfo.hostName
        let pairing = try await RelayAuthClient.createPairing(
          sessionToken: auth.session.token, name: host,
        )
        // iPhone フォールバック (unified QR) のため user_token をローカルキャッシュ。
        writeRelayUserTokenCache(pairing.userToken)
        _ = try await adminClient.configureRelay(
          url: RelayConstants.base, pairingId: pairing.id, agentKey: pairing.agentKey,
        )
        relayConfigured = true
        signInStatus = "サインイン完了 — スマホでも承認できます"
      } catch {
        signInStatus = "サインインに失敗: \(error.localizedDescription)"
      }
    }
  }

  private func writeRelayUserTokenCache(_ token: String) {
    let url = Self.vigiliHome().appendingPathComponent("relay-user-token")
    try? token.data(using: .utf8)?.write(to: url, options: .atomic)
    try? FileManager.default.setAttributes(
      [.posixPermissions: 0o600], ofItemAtPath: url.path,
    )
  }

  private func clearConnectStatusSoon() {
    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
      self?.connectStatus = nil
    }
  }

  private func tickPending() async {
    do {
      let list = try await adminClient.fetchPending()
      let countChanged = pendingCount != list.count
      pending = list
      pendingCount = list.count
      if lastError != nil { lastError = nil }
      // 件数が変わった時だけログ (ノイズ削減)
      if countChanged {
        appLog("pending count -> \(list.count)")
      }
    } catch {
      let msg = (error as? DaemonAdminClient.ClientError)?.errorDescription ?? error.localizedDescription
      // 連続失敗中は同じメッセージで spam しない
      if lastError != msg {
        appLog("tickPending failed: \(msg)")
      }
      lastError = msg
    }
  }

  private func tickStats() async {
    do {
      let s = try await adminClient.fetchStats()
      todayStats = s
      refreshWidget()
    } catch {
      let msg = (error as? DaemonAdminClient.ClientError)?.errorDescription ?? error.localizedDescription
      // stats 失敗時は前回値を残しつつ警告だけ
      appLog("tickStats failed: \(msg)")
      lastError = "stats: \(msg)"
    }
  }

  /// WidgetState を file に書き、WidgetCenter に「再描画してくれ」と知らせる。
  /// pending/stats/wsState が更新された時に呼ぶ。
  /// reload は OS が rate-limit するので spam を恐れる必要は無い (1 秒以内の連続呼び出しは合算)。
  private func refreshWidget() {
    let connected: Bool
    switch wsState {
    case .connected: connected = true
    default: connected = false
    }
    let now = Date()
    let nowMs = Int64(now.timeIntervalSince1970 * 1000)
    let recent: [WidgetState.PendingItem] = pending.prefix(5).map { req in
      let ageSec = max(0, Int(now.timeIntervalSince(req.createdAt)))
      var preview = req.primaryPreview
      if preview.count > 60 { preview = String(preview.prefix(57)) + "…" }
      // Mac の ApprovalCard と同じ要素 (tool / tag色 / リスク) を widget へ渡す。
      let risk = RiskAssessment.evaluate(req)
      return WidgetState.PendingItem(
        id: req.id,
        title: preview,
        ageSeconds: ageSec,
        toolName: req.toolName,
        tag: req.sessionTag,
        tagColorHex: Self.hexString(AgentColor.color(for: req.sessionTag)),
        riskLabel: risk.isFlagged ? risk.label : nil,
        riskDanger: risk.level == .danger
      )
    }
    let state = WidgetState(
      pendingCount: pendingCount,
      todayAllowCount: todayStats?.byDecision.allow ?? 0,
      todayDenyCount: todayStats?.byDecision.deny ?? 0,
      connected: connected,
      updatedAtMs: nowMs,
      recentPending: recent
    )
    // 同じ内容なら書き直さない (count + connected + recent ids で判定)
    if let last = lastWidgetState,
      last.pendingCount == state.pendingCount,
      last.todayAllowCount == state.todayAllowCount,
      last.todayDenyCount == state.todayDenyCount,
      last.connected == state.connected,
      last.recentPending.map(\.id) == state.recentPending.map(\.id)
    {
      return
    }
    lastWidgetState = state
    state.writeAtomically()
    #if canImport(WidgetKit)
      WidgetCenter.shared.reloadTimelines(ofKind: "VigiliPendingWidget")
    #endif
  }

  /// SwiftUI Color → "#RRGGBB"。widget ターゲットは AgentColor/NSColor を持たないため、
  /// host 側でここに変換して PendingItem.tagColorHex に載せる。
  private static func hexString(_ color: Color) -> String {
    let ns = NSColor(color).usingColorSpace(.sRGB) ?? NSColor(color)
    let r = Int((ns.redComponent * 255).rounded())
    let g = Int((ns.greenComponent * 255).rounded())
    let b = Int((ns.blueComponent * 255).rounded())
    return String(format: "#%02X%02X%02X", r, g, b)
  }
}
