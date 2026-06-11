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
/// 接続戦略 (シームレス local ↔ remote):
///   1. Bonjour で同 LAN の daemon を常時 browse
///   2. 見つかれば local 経路 (lanToken と組み合わせて直結 WS) — 最優先・低レイテンシ
///   3. 見つからなければ (= off-LAN) relay 経路 (relayUrl/relayPid/relayUserToken) を使う。
///      relay は agent→client の pending を WS で転送するので、どこからでも承認が届く。
///   4. NWPathMonitor が network 変化を検知したら再評価
///
/// 静的 `lanUrl` (Tailscale ホスト名等、Bonjour で見えない手動ホスト) は relay 未設定時の
/// フォールバックとしてのみ使う。relay があれば off-LAN は必ず relay を選ぶ — 静的 lanUrl が
/// LAN IP だと off-LAN で到達できず「繋がっているのに承認が来ない」状態になるのを防ぐ。
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
  /// 直近 7 日の日別バケット (index 0=今日, 6=7日前)。週次グラフ用。
  @Published var weekStats: [DailyBucket] = []
  @Published var wsState: DaemonWsClient.State = .disconnected
  @Published var isConfigured: Bool = MobileSettings.isConfigured
  /// 現在どの経路で繋がっているか (UI 表示用)。
  @Published var activeRoute: Route = .none
  /// `~/.vigili/.welcomed` 相当 (iOS は UserDefaults)。初回起動時 Welcome 画面を出す。
  @Published var showWelcome: Bool = !UserDefaults.standard.bool(forKey: "vigili.welcomed")

  // --- L4 ホスト型セッション (vigili run) ---
  @Published var sessions: [HostedSession] = []
  @Published var transcripts: [String: [TranscriptLine]] = [:]
  @Published var pendingQuestions: [PendingQuestion] = []
  @Published var pendingPlans: [PendingPlan] = []
  /// ask ルーティングモード (SPEC §2.6)。daemon が単一の真実、WS で同期。
  @Published var askMode: String = "integrated"

  enum Route: Equatable {
    case none
    case lan(host: String)      // 表示用: "192.168.1.5:7878"
    case account(host: String)  // 表示用: "relay.vigili.io" (Sign in with Apple)
    case relay(host: String)    // 表示用: "relay.vigili.io" (legacy QR pairing)
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
    wsClient.$weekStats
      .receive(on: DispatchQueue.main)
      .assign(to: &$weekStats)

    // L4 ホスト型セッション系も mirror
    wsClient.$sessions.receive(on: DispatchQueue.main).assign(to: &$sessions)
    wsClient.$transcripts.receive(on: DispatchQueue.main).assign(to: &$transcripts)
    wsClient.$pendingQuestions.receive(on: DispatchQueue.main).assign(to: &$pendingQuestions)
    wsClient.$pendingPlans.receive(on: DispatchQueue.main).assign(to: &$pendingPlans)
    wsClient.$askMode.receive(on: DispatchQueue.main).assign(to: &$askMode)

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

  /// MobileWelcomeView の CTA 押下で呼ばれる。以後 Welcome を出さないフラグを立てる。
  func dismissWelcome() {
    UserDefaults.standard.set(true, forKey: "vigili.welcomed")
    showWelcome = false
  }

  /// 進行中フラグ (ボタンの二度押し防止 / スピナー表示用)。
  @Published var isSigningIn = false
  /// サインインの最後のエラー (UI 表示用)。
  @Published var signInError: String?

  /// 「Sign in with Apple」CTA から呼ばれる。Apple 認証 → relay session → account 経路で接続。
  /// QR スキャンもパスワードも不要。
  func signInWithApple() async {
    if isSigningIn { return }
    isSigningIn = true
    signInError = nil
    defer { isSigningIn = false }
    do {
      let result = try await AppleSignInCoordinator().signIn()
      let auth = try await RelayAuthClient.signInWithApple(
        identityToken: result.identityToken, rawNonce: result.rawNonce,
      )
      MobileSettings.accountRelayUrl = RelayConstants.base
      MobileSettings.accountSessionToken = auth.session.token
      isConfigured = MobileSettings.isConfigured
      reconfigureAndConnect()  // account 経路を選び、APNs device を登録する
      dismissWelcome()
      appLog("MobileAppCoordinator.signInWithApple: ok account=\(auth.account.id)")
    } catch {
      signInError = error.localizedDescription
      appLog("MobileAppCoordinator.signInWithApple failed: \(error.localizedDescription)")
    }
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
    // 注意: URL 全体をログに出さない (クエリに token が乗るため)。scheme/host のみ。
    let scheme = url.scheme?.lowercased() ?? ""
    appLog("MobileAppCoordinator.handleSetupURL: \(scheme)://\(url.host ?? "?")")
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
      // SECURITY: relay は Vigili が運用する単一ホストのみ許可。
      // 攻撃者が細工リンクで悪意ある relay に接続先を差し替えるのを防ぐ。
      guard RelayConstants.isTrustedRelayURL(relay) else {
        appLog("MobileAppCoordinator.handleSetupURL: untrusted relay host rejected")
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
      // SECURITY: LAN setup は同一 LAN 上の Mac に手元の QR を読ませる前提。
      // deeplink 経由で任意ホストを無確認で接続先にしない (private IP / .local / Tailscale 名のみ許可)。
      guard isPlausibleLanHost(lanUrl) else {
        appLog("MobileAppCoordinator.handleSetupURL: non-LAN host rejected for u=")
        return
      }
      MobileSettings.lanUrl = lanUrl
      MobileSettings.lanToken = lanToken
      didSave = true
    }

    let relayUrl = q("r")
    let relayPid = q("p")
    let relayUserToken = q("k")
    if !relayUrl.isEmpty && !relayPid.isEmpty && !relayUserToken.isEmpty {
      // SECURITY: relay は信頼ホストのみ。
      guard RelayConstants.isTrustedRelayURL(relayUrl) else {
        appLog("MobileAppCoordinator.handleSetupURL: untrusted relay host rejected")
        return
      }
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

  /// LAN setup の host が「同一 LAN にありそう」かを判定する。
  /// 公開インターネットの任意ホストへ deeplink で接続先を差し替えられるのを防ぐ。
  /// 許可: プライベート IP (10./172.16-31./192.168./127.)、.local、ホスト名(ドット無し or .local/.ts.net 等の内部名)。
  /// scheme 付きで来た場合も host 部だけ取り出して判定する。
  private func isPlausibleLanHost(_ raw: String) -> Bool {
    var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.isEmpty { return false }
    // scheme があれば host を取り出す。無ければ host:port とみなす。
    if s.contains("://"), let h = URLComponents(string: s)?.host {
      s = h
    } else if let h = URLComponents(string: "ws://\(s)")?.host {
      s = h
    }
    let host = s.lowercased()
    // 公開インターネットの FQDN (例: relay.attacker.com) は拒否。
    // プライベート IPv4 レンジ
    if host.hasPrefix("127.") || host.hasPrefix("10.") || host.hasPrefix("192.168.") {
      return true
    }
    if host.hasPrefix("172.") {
      let parts = host.split(separator: ".")
      if parts.count >= 2, let second = Int(parts[1]), (16...31).contains(second) {
        return true
      }
    }
    if host == "localhost" { return true }
    // mDNS / Tailscale 等の内部名。公開 TLD を含む FQDN は除外。
    if host.hasSuffix(".local") || host.hasSuffix(".ts.net") || host.hasSuffix(".internal") {
      return true
    }
    // ドットを含まない単一ラベル (例: my-mac) は LAN ホスト名とみなす。
    if !host.contains(".") { return true }
    return false
  }

  // MARK: - 戦略選択

  /// 現状の Bonjour 発見状況 + 保存済み credentials を見て、いま最適な経路を
  /// 選び直す。既に同じ URL に繋がっていれば何もしない。
  private func reevaluateRoute() {
    // (1) 物理的に同一 LAN: Bonjour で daemon を発見 + lanToken がある → 直結 (local)。
    //     低レイテンシなのでこれが最優先。
    if MobileSettings.hasLan,
      let svc = bonjour.services.first(where: { $0.resolvedURL != nil }),
      let resolved = svc.resolvedURL,
      let token = MobileSettings.lanToken
    {
      switchTo(url: resolved, token: token, route: .lan(host: resolved.host ?? "lan"))
      return
    }

    // (2) Account stream (Sign in with Apple) を最優先の remote 経路にする。
    //     同一アカウントに紐づく全 Mac の pending/質問/plan が account stream に流れてくる。
    if MobileSettings.hasAccount,
      let url = MobileSettings.accountWsUrl,
      let token = MobileSettings.accountSessionToken
    {
      let host = MobileSettings.accountRelayUrl.flatMap { URL(string: $0)?.host } ?? "relay"
      switchTo(url: url, token: token, route: .account(host: host))
      return
    }

    // (3) legacy relay (QR pairing) — account が無い既存ユーザー向けフォールバック。
    //     静的 lanUrl (下の (4)) より必ず先に試すのが要点。静的 lanUrl が LAN IP の
    //     場合 off-LAN では到達できず、掴んでしまうと「繋がっているのに承認が来ない」
    //     状態 (= 旧挙動: watching local のまま無音) になっていた。relay を持っているなら
    //     それを使う。Bonjour で LAN daemon が見つかれば (1) が即座に上書きする。
    if MobileSettings.hasRelay,
      let url = MobileSettings.relayWsUrl,
      let token = MobileSettings.relayUserToken
    {
      let host = MobileSettings.relayUrl.flatMap { URL(string: $0)?.host } ?? "relay"
      switchTo(url: url, token: token, route: .relay(host: host))
      return
    }

    // (4) 静的 lanUrl (Tailscale 等、Bonjour で見えない手動ホスト) —
    //     account/relay 未設定時のフォールバックとしてのみ使う。
    if MobileSettings.hasLan,
      let url = MobileSettings.lanWsUrlBase,
      let token = MobileSettings.lanToken
    {
      switchTo(url: url, token: token, route: .lan(host: url.host ?? "lan"))
      return
    }

    // (5) 何も無い
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
    // query を含めずに host/path のみログ (token が将来 url に混ざっても漏らさない)
    appLog("switchTo route=\(route) host=\(url.host ?? "?")\(url.path)")
    currentUrl = url
    activeRoute = route
    wsClient.configure(urlBase: url, token: token)
    wsClient.start()
  }
}
