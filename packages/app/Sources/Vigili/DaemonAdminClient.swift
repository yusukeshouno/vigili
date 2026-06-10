import Foundation
import Network

/// daemon の Unix socket (`~/.sentinel/daemon.sock`) と admin プロトコルで話す client。
///
/// 設計:
/// - 1 リクエスト = 1 接続 (admin プロトコルは1往復で完結する短命メッセージなので
///   コネクションプーリングはしない。socket open はマイクロ秒オーダー)
/// - `Network.framework` の `NWConnection` で Unix domain socket をしゃべる
///   (macOS 11+ で `.unix(path:)` endpoint サポート)
/// - actor で並行アクセスを直列化する
///
/// 未認証 (socket パーミッション 0600 で守る) なので token は不要。
actor DaemonAdminClient {
  enum ClientError: Error, LocalizedError {
    case connectionFailed(String)
    case writeFailed(String)
    case readFailed(String)
    case responseInvalid(String)
    case responseError(String)

    var errorDescription: String? {
      switch self {
      case .connectionFailed(let m): return "connect: \(m)"
      case .writeFailed(let m): return "write: \(m)"
      case .readFailed(let m): return "read: \(m)"
      case .responseInvalid(let m): return "invalid response: \(m)"
      case .responseError(let m): return "server error: \(m)"
      }
    }
  }

  private let socketPath: String

  init(socketPath: String) {
    self.socketPath = socketPath
  }

  /// 現在 pending な ApprovalRequest を取得する。
  func fetchPending() async throws -> [ApprovalRequest] {
    let resp = try await send(request: ["kind": "admin", "action": "pending"])
    guard
      let action = resp["action"] as? String, action == "pending",
      let ok = resp["ok"] as? Bool, ok,
      let pendingArray = resp["pending"] as? [[String: Any]]
    else {
      throw ClientError.responseInvalid("missing pending field")
    }
    return pendingArray.compactMap(ApprovalRequest.init(dict:))
  }

  /// 当日 (ローカル時刻 00:00 〜 現在 + 60s) の集計を取得する。
  /// 引数省略時は daemon 側のデフォルト範囲を使う。
  func fetchStats(fromMs: Int64? = nil, toMs: Int64? = nil) async throws -> StatsBuckets {
    var req: [String: Any] = ["kind": "admin", "action": "stats"]
    if let f = fromMs { req["from_ms"] = f }
    if let t = toMs { req["to_ms"] = t }
    let resp = try await send(request: req)
    guard
      let action = resp["action"] as? String, action == "stats",
      let ok = resp["ok"] as? Bool, ok,
      let statsDict = resp["stats"] as? [String: Any]
    else {
      throw ClientError.responseInvalid("missing stats field")
    }
    guard let stats = StatsBuckets(dict: statsDict) else {
      throw ClientError.responseInvalid("could not parse stats")
    }
    return stats
  }

  /// 現在ロード中のポリシールール一覧を取得する。
  func fetchRules() async throws -> (rules: [PolicyRule], generatedRuleNames: Set<String>) {
    let resp = try await send(request: ["kind": "admin", "action": "rules"])
    guard
      let action = resp["action"] as? String, action == "rules",
      let ok = resp["ok"] as? Bool, ok,
      let rulesArray = resp["rules"] as? [[String: Any]],
      let genNamesArray = resp["generatedRuleNames"] as? [String]
    else {
      throw ClientError.responseInvalid("missing rules field")
    }
    let rules = rulesArray.compactMap(PolicyRule.init(dict:))
    return (rules: rules, generatedRuleNames: Set(genNamesArray))
  }

  /// ポリシーが自動判定した直近の decisions を取得する。
  func fetchHistory(limit: Int = 100) async throws -> [PolicyHistoryItem] {
    var req: [String: Any] = ["kind": "admin", "action": "history"]
    req["limit"] = limit
    let resp = try await send(request: req)
    guard
      let action = resp["action"] as? String, action == "history",
      let ok = resp["ok"] as? Bool, ok,
      let itemsArray = resp["items"] as? [[String: Any]]
    else {
      throw ClientError.responseInvalid("missing history items")
    }
    return itemsArray.compactMap(PolicyHistoryItem.init(dict:))
  }

  /// policy.generated.yaml から指定名のルールを削除してリロードする。
  func deleteGeneratedRule(name: String) async throws {
    let resp = try await send(request: ["kind": "admin", "action": "rule-delete", "name": name])
    guard let ok = resp["ok"] as? Bool, ok else {
      let err = resp["error"] as? String ?? "unknown"
      throw ClientError.responseError(err)
    }
  }

  // MARK: - オンボーディング (ウィザード)

  /// オンボーディングで表示するルール候補カタログ。daemon の POLICY_CATALOG と対応。
  struct CatalogItem: Identifiable {
    let id: String
    let category: String  // "convenience" | "danger"
    let label: String
    let description: String
    /// 質問画面に出す詳細説明 (何が許可されるか / 判定の限界)。
    let detail: String
    /// 設定時に明示確認を要求する注意文。nil = 確認不要。
    let caution: String?
  }

  /// ルールカタログを取得する。
  func fetchPolicyCatalog() async throws -> [CatalogItem] {
    let resp = try await send(request: ["kind": "admin", "action": "policy-catalog"])
    guard
      let action = resp["action"] as? String, action == "policy-catalog",
      let ok = resp["ok"] as? Bool, ok,
      let itemsArray = resp["items"] as? [[String: Any]]
    else {
      throw ClientError.responseInvalid("missing catalog items")
    }
    return itemsArray.compactMap { dict in
      guard
        let id = dict["id"] as? String,
        let category = dict["category"] as? String,
        let label = dict["label"] as? String,
        let description = dict["description"] as? String
      else { return nil }
      return CatalogItem(
        id: id, category: category, label: label, description: description,
        // detail は旧 daemon (フィールド未対応) との互換のため description にフォールバック
        detail: (dict["detail"] as? String) ?? description,
        caution: dict["caution"] as? String,
      )
    }
  }

  /// 選択された ID 群からルールを policy.yaml に書き出す（既存は .bak に退避）。
  func writePolicyFromCatalog(selectedIds: [String]) async throws -> Int {
    let resp = try await send(request: [
      "kind": "admin",
      "action": "policy-write-from-catalog",
      "selected_ids": selectedIds,
    ])
    guard let ok = resp["ok"] as? Bool, ok else {
      let err = resp["error"] as? String ?? "unknown"
      throw ClientError.responseError(err)
    }
    return (resp["written"] as? NSNumber)?.intValue ?? 0
  }

  // MARK: - relay (Sign in with Apple)

  /// relay の接続先を daemon に渡し、config.yaml 永続化 + ホット再接続させる。
  /// プロセス再起動 (`launchctl kickstart`) を経由しない。戻り値は試行直後の接続状態。
  func configureRelay(url: String, pairingId: String, agentKey: String) async throws -> Bool {
    let resp = try await send(request: [
      "kind": "admin",
      "action": "relay-configure",
      "url": url,
      "pairing_id": pairingId,
      "agent_key": agentKey,
    ])
    guard let ok = resp["ok"] as? Bool, ok else {
      throw ClientError.responseError(resp["error"] as? String ?? "unknown")
    }
    return (resp["connected"] as? Bool) ?? false
  }

  /// ログアウト: daemon の relay 接続を停止し config.yaml の relay 節を削除させる。
  func disconnectRelay() async throws {
    let resp = try await send(request: ["kind": "admin", "action": "relay-disconnect"])
    guard let ok = resp["ok"] as? Bool, ok else {
      throw ClientError.responseError(resp["error"] as? String ?? "unknown")
    }
  }

  // MARK: - low level

  private func send(request: [String: Any]) async throws -> [String: Any] {
    let endpoint = NWEndpoint.unix(path: socketPath)
    let parameters = NWParameters.tcp  // Unix socket では SOCK_STREAM を意味する
    let conn = NWConnection(to: endpoint, using: parameters)
    defer { conn.cancel() }

    // 接続が ready になるのを待つ
    try await waitForReady(conn)

    // リクエスト送信 (改行終端、daemon の socket.ts が行区切りで読む)
    let data = try JSONSerialization.data(withJSONObject: request, options: [])
    var payload = data
    payload.append(UInt8(ascii: "\n"))
    try await sendData(payload, on: conn)

    // レスポンス読み取り (改行で終わる JSON)
    let respData = try await receiveLine(on: conn)
    guard let obj = try JSONSerialization.jsonObject(with: respData) as? [String: Any] else {
      throw ClientError.responseInvalid("not a JSON object")
    }
    if let ok = obj["ok"] as? Bool, ok == false {
      let err = obj["error"] as? String ?? "unknown"
      throw ClientError.responseError(err)
    }
    return obj
  }

  private func waitForReady(_ conn: NWConnection) async throws {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      var resumed = false
      conn.stateUpdateHandler = { state in
        guard !resumed else { return }
        switch state {
        case .ready:
          resumed = true
          cont.resume(returning: ())
        case .failed(let err):
          resumed = true
          cont.resume(throwing: ClientError.connectionFailed(err.localizedDescription))
        case .cancelled:
          resumed = true
          cont.resume(throwing: ClientError.connectionFailed("cancelled"))
        default:
          break
        }
      }
      conn.start(queue: .global(qos: .utility))
    }
  }

  private func sendData(_ data: Data, on conn: NWConnection) async throws {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
      conn.send(
        content: data,
        completion: .contentProcessed { err in
          if let err = err {
            cont.resume(throwing: ClientError.writeFailed(err.localizedDescription))
          } else {
            cont.resume(returning: ())
          }
        })
    }
  }

  /// 改行終端まで読み込む。daemon の admin レスポンスは 1 行 JSON。
  private func receiveLine(on conn: NWConnection) async throws -> Data {
    var buffer = Data()
    while true {
      let chunk = try await receiveOnce(on: conn)
      buffer.append(chunk)
      if buffer.contains(0x0A) {
        // 最初の改行までを返す
        if let idx = buffer.firstIndex(of: 0x0A) {
          return buffer.prefix(upTo: idx)
        }
      }
      if chunk.isEmpty {
        // 接続が閉じた
        if !buffer.isEmpty { return buffer }
        throw ClientError.readFailed("connection closed before newline")
      }
    }
  }

  private func receiveOnce(on conn: NWConnection) async throws -> Data {
    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Data, Error>) in
      conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
        data, _, isComplete, err in
        if let err = err {
          cont.resume(throwing: ClientError.readFailed(err.localizedDescription))
        } else if let data = data {
          cont.resume(returning: data)
        } else if isComplete {
          cont.resume(returning: Data())
        } else {
          cont.resume(returning: Data())
        }
      }
    }
  }
}
