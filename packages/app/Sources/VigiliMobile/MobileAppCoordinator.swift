import Foundation
import Combine
import SwiftUI

/// iOS 側のアプリ全体状態 (Mac の AppCoordinator の縮小版)。
///
/// 違い:
/// - daemon プロセスを生やさない (リモート Mac 上で走る前提)
/// - admin Unix socket は使えない (Sandbox + ネットワーク経路の制約)
/// - WS のみで pending / resolved を購読
@MainActor
final class MobileAppCoordinator: ObservableObject {
  let wsClient: DaemonWsClient
  let liveActivity = LiveActivityManager()

  @Published var pending: [ApprovalRequest] = []
  @Published var pendingCount: Int = 0
  @Published var messages: [Message] = []
  @Published var wsState: DaemonWsClient.State = .disconnected
  @Published var isConfigured: Bool = MobileSettings.isConfigured

  private var cancellables = Set<AnyCancellable>()

  init() {
    self.wsClient = DaemonWsClient()
    // 前回終了時に残っていた Activity を一度全部 end (重複表示防止)
    liveActivity.clearStaleActivitiesOnLaunch()

    // WS の pending を反映 + Live Activity も同期
    wsClient.$pending
      .receive(on: DispatchQueue.main)
      .sink { [weak self] list in
        guard let self = self else { return }
        self.pending = list
        self.pendingCount = list.count
        self.liveActivity.sync(pending: list)
      }
      .store(in: &cancellables)

    wsClient.$state
      .receive(on: DispatchQueue.main)
      .assign(to: &$wsState)

    wsClient.$messages
      .receive(on: DispatchQueue.main)
      .assign(to: &$messages)

    if isConfigured {
      reconfigureAndConnect()
    }
  }

  /// Setup 画面で保存ボタンが押された後に呼ばれる。
  func reconfigureAndConnect() {
    guard let urlBase = MobileSettings.wsUrlBase else {
      appLog("MobileAppCoordinator: settings 未完成、未接続")
      isConfigured = false
      return
    }
    let token = MobileSettings.token
    appLog("MobileAppCoordinator: connect to \(urlBase.absoluteString)")
    wsClient.configure(urlBase: urlBase, token: token)
    wsClient.start()
    isConfigured = true
  }

  func disconnect() {
    wsClient.stop()
  }

  /// Setup を全部消して初期画面に戻す。
  func resetSettings() {
    MobileSettings.clear()
    wsClient.stop()
    isConfigured = false
  }

  /// Allow / Deny ボタンから呼ばれる。
  func decide(id: String, decision: String) {
    wsClient.decide(id: id, decision: decision)
  }

  /// `sentinel://setup?u=<host>&t=<token>` または
  /// `vigili://pair?p=<pid>&u=<user_token>&r=<relay_url>` を受け取り、
  /// 設定 + 接続まで一気に進める。
  /// Mac 側の `vigili-cli setup-link` / `vigili-cli pair` で出力した URL を想定。
  func handleSetupURL(_ url: URL) {
    appLog("MobileAppCoordinator.handleSetupURL: \(url.absoluteString.prefix(80))")
    let scheme = url.scheme?.lowercased() ?? ""
    guard scheme == "sentinel" || scheme == "vigili" else { return }
    let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
    let items = comps?.queryItems ?? []
    let host = url.host ?? ""

    if host == "pair" || url.path.contains("pair") {
      // vigili://pair?p=<pid>&u=<user_token>&r=<relay_url>
      let p = items.first(where: { $0.name == "p" })?.value ?? ""
      let u = items.first(where: { $0.name == "u" })?.value ?? ""
      let r = items.first(where: { $0.name == "r" })?.value ?? ""
      let pid = p.trimmingCharacters(in: .whitespacesAndNewlines)
      let userToken = u.trimmingCharacters(in: .whitespacesAndNewlines)
      let relay = r.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !pid.isEmpty, !userToken.isEmpty, !relay.isEmpty else {
        appLog("MobileAppCoordinator.handleSetupURL: pair fields empty")
        return
      }
      // relay URL は base (例: https://relay.vigili.io)。/v1/clients/<pid> を後ろに付けて
      // daemon と同じ DaemonWsClient で繋ぐ (path 終端なので /ws は足されない仕様)。
      let base = relay.hasSuffix("/") ? String(relay.dropLast()) : relay
      MobileSettings.daemonUrl = "\(base)/v1/clients/\(pid)"
      MobileSettings.token = userToken
      reconfigureAndConnect()
      return
    }

    // sentinel://setup?u=<host>&t=<token> (LAN/Tailscale 直結)
    if host == "setup" || url.path.contains("setup") || host.isEmpty {
      let u = items.first(where: { $0.name == "u" })?.value ?? ""
      let t = items.first(where: { $0.name == "t" })?.value ?? ""
      let trimmedU = u.trimmingCharacters(in: .whitespacesAndNewlines)
      let trimmedT = t.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !trimmedU.isEmpty, !trimmedT.isEmpty else {
        appLog("MobileAppCoordinator.handleSetupURL: u or t empty")
        return
      }
      MobileSettings.daemonUrl = trimmedU
      MobileSettings.token = trimmedT
      reconfigureAndConnect()
    }
  }
}
