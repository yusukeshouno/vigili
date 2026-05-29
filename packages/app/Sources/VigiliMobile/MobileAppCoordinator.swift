import Combine
import Foundation
import Network
import SwiftUI
import UIKit

/// iOS 側のアプリ全体状態 (Mac の AppCoordinator の縮小版)。
///
/// 違い:
/// - daemon プロセスを生やさない (リモート Mac 上で走る前提)
/// - admin Unix socket は使えない (Sandbox + ネットワーク経路の制約)
/// - WS のみで pending / resolved を購読
///
/// 接続戦略 (シームレス LAN ↔ relay):
///   1. Bonjour で同 LAN の daemon を常時 browse
///   2. 見つかれば LAN 経路 (lanToken と組み合わせて直結 WS)
///   3. 見つからなければ relay 経路 (relayUrl/relayPid/relayUserToken)
///   4. NWPathMonitor が network 変化を検知したら再評価
///
/// `lanUrl` (Tailscale ホスト名等、Bonjour で見えない静的ホスト) は今のところ
/// 補助的に使う: Bonjour が空 + lanUrl が在る場合は LAN を先に試して、失敗時に
/// relay へフォールバック — というところまでは現状実装しない (MVP)。
@MainActor
final class MobileAppCoordinator: ObservableObject {
  let wsClient: DaemonWsClient
  let liveActivity = LiveActivityManager()
  let bonjour = BonjourBrowser()

  @Published var pending: [ApprovalRequest] = []
  @Published var pendingCount: Int = 0
  @Published var messages: [Message] = []
  /// 観測可能性サマリー (今日の自動承認/承認/ブロック件数等)。待機画面カードが表示する。
  @Published var stats: StatsBuckets? = nil
  @Published var wsState: DaemonWsClient.State = .disconnected
  @Published var isConfigured: Bool = MobileSettings.isConfigured
  /// 現在どの経路で繋がっているか (UI 表示用)。
  @Published var activeRoute: Route = .none
  /// `~/.vigili/.welcomed` 相当 (iOS は UserDefaults)。初回起動時 Welcome 画面を出す。
  @Published var showWelcome: Bool = !UserDefaults.standard.bool(forKey: "vigili.welcomed")

  enum Route: Equatable {
    case none
    case lan(host: String)     // 表示用: "192.168.1.5:7878"
    case relay(host: String)   // 表示用: "relay.vigili.io"
  }

  private var cancellables = Set<AnyCancellable>()
  private let pathMonitor = NWPathMonitor()
  /// 現在 wsClient に渡している URL (重複再接続を避ける)。
  private var currentUrl: URL?

  init() {
    self.wsClient = DaemonWsClient()
    // 前回終了時に残っていた Activity を一度全部 end (重複表示防止)
    liveActivity.clearStaleActivitiesOnLaunch()

    // WS の pending / messages / state を coordinator に mirror
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
    wsClient.$stats
      .receive(on: DispatchQueue.main)
      .assign(to: &$stats)

    // Bonjour 発見状況が変わるたびに戦略を再評価
    bonjour.$services
      .receive(on: DispatchQueue.main)
      .sink { [weak self] _ in
        self?.reevaluateRoute()
      }
      .store(in: &cancellables)

    // ネットワーク経路の変化を検知して再評価
    pathMonitor.pathUpdateHandler = { [weak self] _ in
      Task { @MainActor [weak self] in
        self?.reevaluateRoute()
      }
    }
    pathMonitor.start(queue: .global(qos: .utility))

    // 前面化 (suspend からの復帰) と APNs 通知タップで即再接続する。
    // バックグラウンド中は WS が suspend され ping タイマも止まるため、
    // 復帰直後に明示的に health 確認 → 必要なら貼り直す。
    NotificationCenter.default.addObserver(
      forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main,
    ) { [weak self] _ in
      Task { @MainActor [weak self] in self?.handleForeground() }
    }
    NotificationCenter.default.addObserver(
      forName: .vigiliPushTapped, object: nil, queue: .main,
    ) { [weak self] _ in
      Task { @MainActor [weak self] in self?.handleForeground() }
    }

    if isConfigured {
      bonjour.start()
      // 初回は Bonjour discovery が来る前に relay を試す (LAN 設定だけなら
      // 1〜2 秒 Bonjour 待ってからの方が良いが、最初の値は変化したら自動で
      // 上書きされるので一旦 relay or 何もしない)
      reevaluateRoute()
    }
  }

  // MARK: - Public API

  /// Setup 画面 / deeplink で credentials が更新された後に呼ばれる。
  /// Bonjour も (まだ走っていなければ) 開始する。
  func reconfigureAndConnect() {
    isConfigured = MobileSettings.isConfigured
    if isConfigured {
      bonjour.start()
    }
    reevaluateRoute()
    // QR で relay を後付けした直後など、既に取得済みの APNs token を relay に再登録する。
    RelayDeviceRegistrar.reregisterIfPossible()
  }

  /// 前面化 / 通知タップ時: 網が変わっていれば経路を選び直し、変わっていなければ
  /// 既存接続の health を確認して必要なら即貼り直す。
  private func handleForeground() {
    let before = currentUrl
    reevaluateRoute()
    if currentUrl == before {
      wsClient.reconnectNow()
    }
  }

  func disconnect() {
    wsClient.stop()
    bonjour.stop()
    currentUrl = nil
    activeRoute = .none
  }

  /// Setup を全部消して初期画面に戻す。
  func resetSettings() {
    MobileSettings.clear()
    disconnect()
    isConfigured = false
  }

  /// Allow / Deny ボタンから呼ばれる。
  func decide(id: String, decision: String) {
    wsClient.decide(id: id, decision: decision)
  }

  /// "今後は自動で承認" ボタンから呼ばれる。
  func decideAndPromote(id: String, request: ApprovalRequest) {
    wsClient.decideWithPromote(id: id, promote: request.buildPromotePayload())
  }

  /// MobileWelcomeView の CTA 押下で呼ばれる。以後 Welcome を出さないフラグを立てる。
  func dismissWelcome() {
    UserDefaults.standard.set(true, forKey: "vigili.welcomed")
    showWelcome = false
  }

  /// セットアップ URL を受け取って LAN / relay の credentials を保存し reconnect する。
  ///
  /// 対応スキーマ:
  ///   - **unified (推奨)**: `vigili://setup?u=<host>&t=<token>&r=<relay>&p=<pid>&k=<user_token>`
  ///     一つの QR で LAN と relay 両方を設定できる (`vigili-daemon qr` で生成)。
  ///     u/t だけなら LAN、r/p/k だけなら relay、両方あれば両方保存。
  ///   - **後方互換 (LAN-only)**: `sentinel://setup?u=<host>&t=<token>`
  ///   - **後方互換 (relay-only)**: `vigili://pair?p=<pid>&u=<user_token>&r=<relay_url>`
  ///
  /// 既存の他経路は消さない (両方並列に保てる)。
  func handleSetupURL(_ url: URL) {
    appLog("MobileAppCoordinator.handleSetupURL: \(url.absoluteString.prefix(80))")
    let scheme = url.scheme?.lowercased() ?? ""
    guard scheme == "sentinel" || scheme == "vigili" else { return }
    let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
    let items = comps?.queryItems ?? []
    let host = url.host ?? ""

    @inline(__always)
    func q(_ key: String) -> String {
      (items.first { $0.name == key }?.value ?? "")
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // 後方互換: vigili://pair (relay-only) は u を user_token として扱う
    if host == "pair" || url.path.contains("pair") {
      let pid = q("p")
      let userToken = q("u")
      let relay = q("r")
      guard !pid.isEmpty, !userToken.isEmpty, !relay.isEmpty else {
        appLog("MobileAppCoordinator.handleSetupURL: pair fields empty")
        return
      }
      MobileSettings.relayUrl = relay
      MobileSettings.relayPid = pid
      MobileSettings.relayUserToken = userToken
      reconfigureAndConnect()
      return
    }

    // unified: setup スキーマ
    // u/t があれば LAN を保存、r/p/k があれば relay を保存。
    var didSave = false
    let lanUrl = q("u")
    let lanToken = q("t")
    if !lanUrl.isEmpty && !lanToken.isEmpty {
      MobileSettings.lanUrl = lanUrl
      MobileSettings.lanToken = lanToken
      didSave = true
    }

    let relayUrl = q("r")
    let relayPid = q("p")
    let relayUserToken = q("k")
    if !relayUrl.isEmpty && !relayPid.isEmpty && !relayUserToken.isEmpty {
      MobileSettings.relayUrl = relayUrl
      MobileSettings.relayPid = relayPid
      MobileSettings.relayUserToken = relayUserToken
      didSave = true
    }

    if didSave {
      reconfigureAndConnect()
    } else {
      appLog("MobileAppCoordinator.handleSetupURL: no fields recognized")
    }
  }

  // MARK: - 戦略選択

  /// 現状の Bonjour 発見状況 + 保存済み credentials を見て、いま最適な経路を
  /// 選び直す。既に同じ URL に繋がっていれば何もしない。
  private func reevaluateRoute() {
    // (1) LAN を優先: Bonjour で見つかった + lanToken がある
    if MobileSettings.hasLan,
      let svc = bonjour.services.first(where: { $0.resolvedURL != nil }),
      let resolved = svc.resolvedURL,
      let token = MobileSettings.lanToken
    {
      switchTo(url: resolved, token: token, route: .lan(host: resolved.host ?? "lan"))
      return
    }

    // (2) Bonjour 不在で lanUrl が手で設定されている (Tailscale 等)
    //     こちらも LAN とみなす。Bonjour で見つかれば step 1 で上書きされる。
    if MobileSettings.hasLan,
      let url = MobileSettings.lanWsUrlBase,
      let token = MobileSettings.lanToken,
      // ただし Bonjour が active で「探したけど無かった」と判明したケースでは
      // LAN を試して即失敗する可能性が高いので relay があるならそっちを優先する。
      // ここでは「Bonjour に何も見つかっていない + 静的 lanUrl がある」場合に
      // 限定して LAN を試す。
      !bonjour.isBrowsing || !bonjour.services.isEmpty || !MobileSettings.hasRelay
    {
      switchTo(url: url, token: token, route: .lan(host: url.host ?? "lan"))
      return
    }

    // (3) Relay
    if MobileSettings.hasRelay,
      let url = MobileSettings.relayWsUrl,
      let token = MobileSettings.relayUserToken
    {
      let host = MobileSettings.relayUrl.flatMap { URL(string: $0)?.host } ?? "relay"
      switchTo(url: url, token: token, route: .relay(host: host))
      return
    }

    // (4) 何も無い
    if currentUrl != nil {
      appLog("reevaluate: no credentials, disconnecting")
      wsClient.stop()
      currentUrl = nil
      activeRoute = .none
    }
  }

  /// 同じ URL なら no-op、違えば wsClient を reconfigure + restart。
  private func switchTo(url: URL, token: String, route: Route) {
    if currentUrl == url, activeRoute == route {
      // 既に同じ経路で繋がっている — 何もしない
      return
    }
    appLog("switchTo route=\(route) url=\(url.absoluteString.prefix(60))…")
    currentUrl = url
    activeRoute = route
    wsClient.configure(urlBase: url, token: token)
    wsClient.start()
  }
}
