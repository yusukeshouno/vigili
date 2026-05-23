import Foundation
import Combine
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
  @Published var daemonStatus: DaemonController.Status = .stopped
  @Published var wsState: DaemonWsClient.State = .disconnected
  @Published var lastError: String?

  private var pollTimer: Timer?
  private var tickCount = 0

  /// 直前に widget へ書き出した state。同じ内容で reloadTimelines を spam しないため。
  private var lastWidgetState: WidgetState?

  /// daemon socket のパス。SENTINEL_HOME 環境変数で override 可能。
  private static func defaultSocketPath() -> String {
    let home = ProcessInfo.processInfo.environment["SENTINEL_HOME"]
      ?? "\(FileManager.default.homeDirectoryForCurrentUser.path)/.sentinel"
    return "\(home)/daemon.sock"
  }

  init() {
    let socketPath = Self.defaultSocketPath()
    self.daemonController = DaemonController()
    self.adminClient = DaemonAdminClient(socketPath: socketPath)
    // Mac は localhost: 7878 に直接繋ぐ。token は ~/.sentinel/token から読む。
    self.wsClient = DaemonWsClient(
      urlBase: URL(string: "ws://127.0.0.1:7878")!,
      token: DaemonWsClient.macHomeToken()
    )
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
      }
      if self.tickCount % 5 == 0 {
        await self.tickStats()
      }
      self.tickCount &+= 1
    }
  }

  /// PopoverContentView から呼ばれる Allow / Deny。
  func decide(id: String, decision: String) {
    wsClient.decide(id: id, decision: decision)
  }

  /// MessageComposerView から呼ばれる: Claude にひとこと送る。
  func sendMessage(sessionId: String, body: String) {
    wsClient.sendMessage(sessionId: sessionId, body: body)
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
      let title = "\(req.toolName) · \(preview)"
      return WidgetState.PendingItem(id: req.id, title: title, ageSeconds: ageSec)
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
}
