import Foundation
import Combine

/// daemon の `ws[s]://<host>/ws?token=<bearer>` に繋ぐ WebSocket クライアント。
///
/// 役割:
/// - 接続が確立したら `snapshot` メッセージで pending 全件を受け取る
/// - 以降 `pending` (新規 ask) と `resolved` (決着) が push される
/// - 接続が落ちたら指数バックオフで再接続
/// - 端末側で承認するときは `decide` を送信
///
/// 認証: token は呼び出し側から渡す。
///   - Mac: `~/.sentinel/token` を読んで渡す (`DaemonWsClient.macHomeToken()` 補助あり)
///   - iOS: ユーザが UI で入力したものを Keychain / UserDefaults に保存して渡す
@MainActor
final class DaemonWsClient: ObservableObject {
  enum State: Equatable {
    case disconnected
    case connecting
    case connected
    case failed(String)
  }

  /// 現在の pending リスト。WS の snapshot / pending / resolved を統合した結果。
  @Published private(set) var pending: [ApprovalRequest] = []
  @Published private(set) var state: State = .disconnected

  /// 接続先 (例: `ws://127.0.0.1:7878` または `wss://my-mac.tail-xxxx.ts.net`)。
  private var urlBase: URL
  /// 認証 bearer。空文字なら接続せず failed にする。
  private var token: String

  private var task: URLSessionWebSocketTask?
  private var session: URLSession?
  private var reconnectAttempts = 0
  private var reconnectWork: DispatchWorkItem?
  private var receiveTask: Task<Void, Never>?

  init(urlBase: URL = URL(string: "ws://127.0.0.1:7878")!, token: String = "") {
    self.urlBase = urlBase
    self.token = token
  }

  /// 接続先 / token を後から差し替える (iOS の Setup 画面で使う)。
  /// 既に接続中なら一度切って再接続する。
  func configure(urlBase: URL, token: String) {
    let wasConnected = (state != .disconnected)
    self.urlBase = urlBase
    self.token = token
    if wasConnected {
      stop()
      start()
    }
  }

  /// Mac 専用: `~/.sentinel/token` を読む補助。
  /// iOS では使えない (sandbox の外を読めない) のでこの関数を呼ばない。
  static func macHomeToken() -> String {
    #if os(macOS)
    let url = FileManager.default.homeDirectoryForCurrentUser
      .appendingPathComponent(".sentinel/token")
    return (try? String(contentsOf: url, encoding: .utf8))?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    #else
    return ""
    #endif
  }

  // MARK: - public

  func start() {
    if case .connected = state { return }
    connect()
  }

  func stop() {
    reconnectWork?.cancel()
    reconnectWork = nil
    receiveTask?.cancel()
    receiveTask = nil
    task?.cancel(with: .goingAway, reason: nil)
    task = nil
    state = .disconnected
  }

  /// Allow / Deny ボタンから呼ばれる。
  func decide(id: String, decision: String) {
    guard let task = task, case .connected = state else {
      appLog("ws.decide: not connected, ignoring")
      return
    }
    let msg: [String: Any] = ["type": "decide", "id": id, "decision": decision]
    sendJson(msg, on: task)
    // optimistic update: ローカルでも消しておく (resolved で本確認)
    pending.removeAll { $0.id == id }
  }

  // MARK: - private

  private func connect() {
    state = .connecting
    guard !token.isEmpty else {
      state = .failed("token is empty (configure() を呼んでください)")
      // token が無い時は backoff しない (ユーザの設定待ち)
      return
    }

    var components = URLComponents(url: urlBase, resolvingAgainstBaseURL: false)!
    // urlBase 側の path が既にあればそれを尊重し、末尾に /ws を追加。
    // 例: https://mac.tail.ts.net (path 空) → /ws
    //     https://mac.tail.ts.net/api (path /api) → /api/ws
    let basePath = components.path.hasSuffix("/")
      ? String(components.path.dropLast())
      : components.path
    components.path = "\(basePath)/ws"
    components.queryItems = [URLQueryItem(name: "token", value: token)]
    guard let url = components.url else {
      state = .failed("invalid url")
      return
    }

    let cfg = URLSessionConfiguration.default
    cfg.waitsForConnectivity = false
    let s = URLSession(configuration: cfg)
    self.session = s
    let task = s.webSocketTask(with: url)
    self.task = task
    task.resume()
    appLog("ws.connect → \(url.absoluteString.prefix(60))…")

    // 受信ループ
    receiveTask = Task { @MainActor [weak self] in
      await self?.receiveLoop()
    }

    // URLSessionWebSocketTask には明示的な open イベントが無いので
    // 最初の receive 成功 or 失敗で connected / failed を確定する。
    state = .connected
    reconnectAttempts = 0
  }

  private func receiveLoop() async {
    while !Task.isCancelled, let task = task {
      do {
        let msg = try await task.receive()
        switch msg {
        case .string(let s):
          handleIncoming(text: s)
        case .data(let d):
          if let s = String(data: d, encoding: .utf8) {
            handleIncoming(text: s)
          }
        @unknown default:
          break
        }
      } catch {
        appLog("ws.receive failed: \(error.localizedDescription)")
        state = .failed(error.localizedDescription)
        self.task = nil
        scheduleReconnect()
        return
      }
    }
  }

  private func handleIncoming(text: String) {
    guard let data = text.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let type = obj["type"] as? String else {
      return
    }
    switch type {
    case "snapshot":
      if let arr = obj["pending"] as? [[String: Any]] {
        pending = arr.compactMap(ApprovalRequest.init(dict:))
        appLog("ws.snapshot \(pending.count) pending")
      }
    case "pending":
      if let r = obj["request"] as? [String: Any], let req = ApprovalRequest(dict: r) {
        // 既存に同じ id が無いか確認 (snapshot との競合防止)
        if !pending.contains(where: { $0.id == req.id }) {
          pending.append(req)
          appLog("ws.pending +1 (\(req.toolName)) total=\(pending.count)")
        }
      }
    case "resolved":
      if let id = obj["id"] as? String {
        pending.removeAll { $0.id == id }
        appLog("ws.resolved -1 total=\(pending.count)")
      }
    default:
      break
    }
  }

  private func sendJson(_ obj: [String: Any], on task: URLSessionWebSocketTask) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let text = String(data: data, encoding: .utf8) else {
      return
    }
    task.send(.string(text)) { err in
      if let err = err {
        Task { @MainActor in
          appLog("ws.send failed: \(err.localizedDescription)")
        }
      }
    }
  }

  private func scheduleReconnect() {
    reconnectWork?.cancel()
    reconnectAttempts += 1
    let delay = min(pow(2.0, Double(min(reconnectAttempts, 5))), 30.0)
    let work = DispatchWorkItem { [weak self] in
      Task { @MainActor [weak self] in
        self?.connect()
      }
    }
    reconnectWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    appLog("ws.reconnect in \(Int(delay))s (attempt \(reconnectAttempts))")
  }
}
