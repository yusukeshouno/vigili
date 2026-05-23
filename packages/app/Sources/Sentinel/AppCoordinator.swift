import Foundation
import Combine

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
  @Published var todayStats: StatsBuckets?
  @Published var daemonStatus: DaemonController.Status = .stopped
  @Published var wsState: DaemonWsClient.State = .disconnected
  @Published var lastError: String?

  private var pollTimer: Timer?
  private var tickCount = 0

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
      }
      .store(in: &cancellables)

    wsClient.$state
      .receive(on: DispatchQueue.main)
      .assign(to: &$wsState)

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
    } catch {
      let msg = (error as? DaemonAdminClient.ClientError)?.errorDescription ?? error.localizedDescription
      // stats 失敗時は前回値を残しつつ警告だけ
      appLog("tickStats failed: \(msg)")
      lastError = "stats: \(msg)"
    }
  }
}
