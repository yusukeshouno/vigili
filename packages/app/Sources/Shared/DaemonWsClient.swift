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
  /// 観測可能性サマリー (今日の自動承認/承認/ブロック件数等)。
  /// daemon が接続直後と決着のたびに push する。未受信なら nil。
  @Published private(set) var stats: StatsBuckets? = nil

  // --- L4 ホスト型セッション (vigili run) ---
  /// 稼働中のホスト型セッション。snapshot / session-started / session-ended で更新。
  @Published private(set) var sessions: [HostedSession] = []
  /// session_id → transcript 行。transcript-append で追記、session-ended で破棄。
  @Published private(set) var transcripts: [String: [TranscriptLine]] = [:]
  /// 回答待ちの選択肢質問 (AskUserQuestion)。request_id 単位。
  @Published private(set) var pendingQuestions: [PendingQuestion] = []
  /// 承認待ちの plan (ExitPlanMode)。request_id 単位。
  @Published private(set) var pendingPlans: [PendingPlan] = []
  /// transcript の上限 (セッションあたり)。古い行から落とす。
  private let transcriptCap = 500

  /// 接続先 (例: `ws://127.0.0.1:7878` または `wss://my-mac.tail-xxxx.ts.net`)。
  private var urlBase: URL
  /// 認証 bearer。空文字なら接続せず failed にする。
  private var token: String

  private var task: URLSessionWebSocketTask?
  private var session: URLSession?
  private var reconnectAttempts = 0
  private var reconnectWork: DispatchWorkItem?
  private var receiveTask: Task<Void, Never>?
  /// keepalive 用の周期 ping ループ。half-open 接続 (網切替・スリープ後) を検知する。
  private var pingTask: Task<Void, Never>?
  /// ping 間隔 (秒)。relay/daemon 側の watchdog より短くして先に自分で気付く。
  /// 短いほど half-open / sleep 復帰の検知が速く、再同期が積極的になる。
  private let pingIntervalSeconds: UInt64 = 10

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
    stopPing()
    receiveTask?.cancel()
    receiveTask = nil
    task?.cancel(with: .goingAway, reason: nil)
    task = nil
    state = .disconnected
  }

  /// アプリ前面化 / 通知タップ時に即再接続させる。
  ///
  /// バックグラウンドで suspend されている間は ping タイマも止まるため、復帰直後の
  /// 接続は half-open のまま放置されがち。バックオフ待ちを飛ばして health を確認し、
  /// 死んでいれば即貼り直す。
  ///   - .connected: ping を 1 発撃ち、失敗したら貼り直す
  ///   - それ以外:    stop して即 connect
  func reconnectNow() {
    reconnectWork?.cancel()
    reconnectWork = nil
    reconnectAttempts = 0
    guard case .connected = state, let task = task else {
      stop()
      connect()
      return
    }
    task.sendPing { [weak self] error in
      guard let error = error else { return }
      Task { @MainActor [weak self] in
        guard let self = self, case .connected = self.state else { return }
        appLog("ws.reconnectNow: ping failed (\(error.localizedDescription)) — reconnect")
        self.task?.cancel(with: .goingAway, reason: nil)
        self.task = nil
        self.receiveTask?.cancel()
        self.receiveTask = nil
        self.stopPing()
        self.connect()
      }
    }
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

  // MARK: - L4 ホスト型セッション (vigili run) への返信

  /// AskUserQuestion への回答を返す。`answers` は {<question>: <選択 label>} 形。
  func answerQuestion(requestId: String, answers: [String: String]) {
    guard let task = task, case .connected = state else {
      appLog("ws.answerQuestion: not connected, ignoring")
      return
    }
    let msg: [String: Any] = [
      "type": "answer-question",
      "request_id": requestId,
      "answers": answers,
    ]
    sendJson(msg, on: task)
    // optimistic: ローカルから消す (runner 側で answer が消費される)
    pendingQuestions.removeAll { $0.requestId == requestId }
  }

  /// plan (ExitPlanMode) の承認 / 却下を返す。decision は "approve" | "reject"。
  func decidePlan(requestId: String, decision: String, reason: String? = nil) {
    guard let task = task, case .connected = state else {
      appLog("ws.decidePlan: not connected, ignoring")
      return
    }
    var msg: [String: Any] = [
      "type": "decide-plan",
      "request_id": requestId,
      "decision": decision,
    ]
    if let reason = reason, !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      msg["reason"] = reason
    }
    sendJson(msg, on: task)
    pendingPlans.removeAll { $0.requestId == requestId }
  }

  /// ホスト型セッションへの自由文返信 (次の user turn になる)。
  func sendSessionReply(sessionId: String, body: String) {
    let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !sessionId.isEmpty, !trimmed.isEmpty else { return }
    guard let task = task, case .connected = state else {
      appLog("ws.sendSessionReply: not connected, ignoring")
      return
    }
    let msg: [String: Any] = [
      "type": "session-reply",
      "session_id": sessionId,
      "body": trimmed,
    ]
    sendJson(msg, on: task)
    // optimistic: transcript に user 行として即時反映する
    var lines = transcripts[sessionId] ?? []
    lines.append(TranscriptLine(role: "user", text: trimmed, at: Date(), toolName: nil))
    transcripts[sessionId] = lines
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
    startPing()
  }

  /// 周期 ping で half-open 接続を検知する。URLSessionWebSocketTask は相手が黙って
  /// 消えても receive() が即座には throw しない (スリープ・網切替・NAT 失効)。ping が
  /// 失敗したら接続が死んでいるとみなし、明示的に貼り直す。
  private func startPing() {
    pingTask?.cancel()
    pingTask = Task { @MainActor [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(nanoseconds: (self?.pingIntervalSeconds ?? 15) * 1_000_000_000)
        guard !Task.isCancelled, let self = self, let task = self.task else { return }
        task.sendPing { [weak self] error in
          guard let error = error else { return }
          Task { @MainActor [weak self] in
            guard let self = self, case .connected = self.state else { return }
            appLog("ws.ping failed: \(error.localizedDescription) — reconnect")
            self.state = .failed(error.localizedDescription)
            self.task?.cancel(with: .goingAway, reason: nil)
            self.task = nil
            self.receiveTask?.cancel()
            self.receiveTask = nil
            self.scheduleReconnect()
          }
        }
      }
    }
  }

  private func stopPing() {
    pingTask?.cancel()
    pingTask = nil
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
        stopPing()
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
      if let arr = obj["sessions"] as? [[String: Any]] {
        sessions = arr.compactMap(HostedSession.init(dict:))
        appLog("ws.snapshot \(sessions.count) sessions")
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
    case "stats":
      if let s = obj["stats"] as? [String: Any], let parsed = StatsBuckets(dict: s) {
        stats = parsed
        appLog("ws.stats total=\(parsed.total) allow=\(parsed.byDecision.allow)")
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
    // --- L4 ホスト型セッション (vigili run) ---
    case "session-started":
      if let s = obj["session"] as? [String: Any], let sess = HostedSession(dict: s) {
        if let idx = sessions.firstIndex(where: { $0.sessionId == sess.sessionId }) {
          sessions[idx] = sess
        } else {
          sessions.append(sess)
        }
        appLog("ws.session-started \(sess.sessionId) (\(sess.displayName))")
      }
    case "session-ended":
      if let sid = obj["session_id"] as? String {
        sessions.removeAll { $0.sessionId == sid }
        transcripts[sid] = nil
        pendingQuestions.removeAll { $0.sessionId == sid }
        pendingPlans.removeAll { $0.sessionId == sid }
        appLog("ws.session-ended \(sid)")
      }
    case "transcript-append":
      if let sid = obj["session_id"] as? String,
         let l = obj["line"] as? [String: Any], let line = TranscriptLine(dict: l) {
        var lines = transcripts[sid] ?? []
        lines.append(line)
        if lines.count > transcriptCap {
          lines.removeFirst(lines.count - transcriptCap)
        }
        transcripts[sid] = lines
      }
    case "question":
      if let sid = obj["session_id"] as? String,
         let rid = obj["request_id"] as? String,
         let qs = obj["questions"] as? [[String: Any]] {
        if !pendingQuestions.contains(where: { $0.requestId == rid }) {
          let questions = qs.compactMap(Question.init(dict:))
          pendingQuestions.append(
            PendingQuestion(sessionId: sid, requestId: rid, questions: questions))
          appLog("ws.question +1 (\(questions.count)q) session=\(sid)")
        }
      }
    case "plan":
      if let sid = obj["session_id"] as? String,
         let rid = obj["request_id"] as? String,
         let plan = obj["plan"] as? String {
        if !pendingPlans.contains(where: { $0.requestId == rid }) {
          pendingPlans.append(PendingPlan(sessionId: sid, requestId: rid, plan: plan))
          appLog("ws.plan +1 session=\(sid)")
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
    // backoff は最大 8s で頭打ち。短く保ち、断線時の再同期を積極的にする。
    let delay = min(pow(2.0, Double(min(reconnectAttempts, 3))), 8.0)
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
