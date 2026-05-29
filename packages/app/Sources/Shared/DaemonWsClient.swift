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
  /// 直近 + 未配送のメッセージ (created_at 降順)。composer の history 表示用。
  @Published private(set) var messages: [Message] = []

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

  /// Mac 専用: `~/.vigili/token` を読む補助 (旧 `~/.sentinel/token` も fallback)。
  /// iOS では使えない (sandbox の外を読めない) のでこの関数を呼ばない。
  /// クラス本体の MainActor 隔離からは独立 (純粋にファイル読み)。
  nonisolated static func macHomeToken() -> String {
    #if os(macOS)
    let home = FileManager.default.homeDirectoryForCurrentUser
    for sub in [".vigili/token", ".sentinel/token"] {
      let url = home.appendingPathComponent(sub)
      if let t = try? String(contentsOf: url, encoding: .utf8) {
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
      }
    }
    return ""
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

  /// "今後も自動で承認" ボタンから呼ばれる。
  /// `decision: allow` と同時に `promote` を送り、daemon が policy.generated.yaml に追記する。
  func decideWithPromote(id: String, promote: [String: Any]) {
    guard let task = task, case .connected = state else {
      appLog("ws.decideWithPromote: not connected, ignoring")
      return
    }
    let msg: [String: Any] = [
      "type": "decide",
      "id": id,
      "decision": "allow",
      "promote": promote,
    ]
    sendJson(msg, on: task)
    pending.removeAll { $0.id == id }
  }

  /// Composer から呼ばれる: 指定 session_id 宛にメッセージを enqueue する。
  /// daemon が次回 gate fire 時に additionalContext として Claude に届ける。
  func sendMessage(sessionId: String, body: String) {
    let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !sessionId.isEmpty, !trimmed.isEmpty else { return }
    guard let task = task, case .connected = state else {
      appLog("ws.sendMessage: not connected, ignoring")
      return
    }
    let msg: [String: Any] = [
      "type": "send-message",
      "session_id": sessionId,
      "body": trimmed,
    ]
    sendJson(msg, on: task)
    // optimistic ack: server からの message-added で正式に上書きされる
    let placeholder = Message(
      id: "tmp-\(Int(Date().timeIntervalSince1970 * 1000))",
      sessionId: sessionId,
      body: trimmed,
      createdAt: Date(),
      deliveredAt: nil
    )
    messages.insert(placeholder, at: 0)
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
    // 例外: relay の `/v1/clients/<pid>` は終端なので /ws を足さない (Vigili Cloud)。
    let basePath = components.path.hasSuffix("/")
      ? String(components.path.dropLast())
      : components.path
    if basePath.contains("/v1/clients/") {
      components.path = basePath
    } else {
      components.path = "\(basePath)/ws"
    }
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
      if let arr = obj["messages"] as? [[String: Any]] {
        messages = arr.compactMap(Message.init(dict:))
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
    case "message-added":
      if let m = obj["message"] as? [String: Any], let msg = Message(dict: m) {
        // 同じ id が既にあれば上書き (optimistic placeholder の差し替え)、
        // 無ければ降順 (新しい順) で頭に挿入し最大 100 件保持。
        if let idx = messages.firstIndex(where: { $0.id == msg.id }) {
          messages[idx] = msg
        } else {
          // tmp- placeholder と body 一致なら差し替え
          if let idx = messages.firstIndex(where: {
            $0.id.hasPrefix("tmp-") && $0.body == msg.body && $0.sessionId == msg.sessionId
          }) {
            messages[idx] = msg
          } else {
            messages.insert(msg, at: 0)
            if messages.count > 100 { messages.removeLast(messages.count - 100) }
          }
        }
        appLog("ws.message-added \(msg.id) → \(msg.sessionId)")
      }
    case "message-delivered":
      if let id = obj["id"] as? String,
         let delivered = (obj["delivered_at"] as? NSNumber)?.doubleValue {
        if let idx = messages.firstIndex(where: { $0.id == id && $0.deliveredAt == nil }) {
          let old = messages[idx]
          messages[idx] = Message(
            id: old.id,
            sessionId: old.sessionId,
            body: old.body,
            createdAt: old.createdAt,
            deliveredAt: Date(timeIntervalSince1970: delivered / 1000.0)
          )
          appLog("ws.message-delivered \(id)")
        }
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
