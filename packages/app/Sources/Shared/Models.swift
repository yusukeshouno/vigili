import Foundation

/// daemon の `ApprovalRequest` zod スキーマと対応する Swift モデル。
///
/// JSON decoding はゆるく [String: Any] → init 経由でやる。
/// 厳密 Codable にすると tool_input の `Record<string, unknown>` 部分が辛い。
struct ApprovalRequest: Identifiable, Hashable {
  let id: String
  let createdAt: Date
  let resolvedAt: Date?
  let sessionId: String
  let sessionTag: String?
  let toolName: String
  /// 任意 JSON。SwiftUI 表示用には `String(describing:)` で書き出すか、
  /// 12-C で個別フィールド (command, file_path, url) を抽出する。
  let toolInput: [String: Any]
  let cwd: String
  let decision: String?  // "allow" | "deny" | null
  let decidedBy: String?
  let reason: String?

  init?(dict: [String: Any]) {
    guard
      let id = dict["id"] as? String,
      let createdMs = (dict["created_at"] as? NSNumber)?.doubleValue,
      let sessionId = dict["session_id"] as? String,
      let toolName = dict["tool_name"] as? String,
      let toolInput = dict["tool_input"] as? [String: Any],
      let cwd = dict["cwd"] as? String
    else { return nil }
    self.id = id
    self.createdAt = Date(timeIntervalSince1970: createdMs / 1000.0)
    if let r = (dict["resolved_at"] as? NSNumber)?.doubleValue {
      self.resolvedAt = Date(timeIntervalSince1970: r / 1000.0)
    } else {
      self.resolvedAt = nil
    }
    self.sessionId = sessionId
    self.sessionTag = dict["session_tag"] as? String
    self.toolName = toolName
    self.toolInput = toolInput
    self.cwd = cwd
    self.decision = dict["decision"] as? String
    self.decidedBy = dict["decided_by"] as? String
    self.reason = dict["reason"] as? String
  }

  // Hashable に必要なものだけ。toolInput は除外。
  func hash(into hasher: inout Hasher) {
    hasher.combine(id)
    hasher.combine(createdAt)
  }
  static func == (lhs: ApprovalRequest, rhs: ApprovalRequest) -> Bool {
    lhs.id == rhs.id && lhs.decision == rhs.decision
  }

  // MARK: - 表示用 helpers

  /// 12-C のカード表示で使う「コマンドのプレビュー」。
  var primaryPreview: String {
    switch toolName {
    case "Bash":
      return (toolInput["command"] as? String) ?? "(no command)"
    case "Edit", "Write":
      return (toolInput["file_path"] as? String) ?? (toolInput["path"] as? String) ?? "(no path)"
    case "WebFetch":
      return (toolInput["url"] as? String) ?? "(no url)"
    default:
      return String(describing: toolInput).prefix(120).description
    }
  }
}

/// daemon の `StatsBuckets` (db/stats.ts) と対応する Swift モデル。
struct StatsBuckets {
  struct ByDecision {
    let allow: Int
    let deny: Int
    let pending: Int
  }
  struct HumanResponse {
    let count: Int
    let mean: Double?
    let p50: Double?
    let p95: Double?
    let max: Double?
  }
  struct Range {
    let from: Date
    let to: Date
  }

  let total: Int
  let byDecision: ByDecision
  /// "auto-rule" / "human-pwa" / "timeout" 等のキー。daemon の DecisionSource enum と対応。
  let bySource: [String: Int]
  let byTool: [String: Int]
  let byTag: [String: Int]
  let humanResponse: HumanResponse
  let range: Range

  init?(dict: [String: Any]) {
    guard
      let total = (dict["total"] as? NSNumber)?.intValue,
      let bd = dict["by_decision"] as? [String: Any],
      let allow = (bd["allow"] as? NSNumber)?.intValue,
      let deny = (bd["deny"] as? NSNumber)?.intValue,
      let pendingC = (bd["pending"] as? NSNumber)?.intValue,
      let bs = dict["by_source"] as? [String: Any],
      let bt = dict["by_tool"] as? [String: Any],
      let bg = dict["by_tag"] as? [String: Any],
      let hr = dict["human_response_ms"] as? [String: Any],
      let r = dict["range"] as? [String: Any],
      let rFrom = (r["from"] as? NSNumber)?.doubleValue,
      let rTo = (r["to"] as? NSNumber)?.doubleValue
    else { return nil }
    self.total = total
    self.byDecision = ByDecision(allow: allow, deny: deny, pending: pendingC)
    self.bySource = bs.compactMapValues { ($0 as? NSNumber)?.intValue }
    self.byTool = bt.compactMapValues { ($0 as? NSNumber)?.intValue }
    self.byTag = bg.compactMapValues { ($0 as? NSNumber)?.intValue }
    self.humanResponse = HumanResponse(
      count: (hr["count"] as? NSNumber)?.intValue ?? 0,
      mean: (hr["mean"] as? NSNumber)?.doubleValue,
      p50: (hr["p50"] as? NSNumber)?.doubleValue,
      p95: (hr["p95"] as? NSNumber)?.doubleValue,
      max: (hr["max"] as? NSNumber)?.doubleValue
    )
    self.range = Range(
      from: Date(timeIntervalSince1970: rFrom / 1000.0),
      to: Date(timeIntervalSince1970: rTo / 1000.0)
    )
  }

  // MARK: - 表示用 helpers

  /// "372 allow · 22 deny" のような 1 行サマリー。
  var oneLineSummary: String {
    "\(byDecision.allow) allow · \(byDecision.deny) deny"
  }

  /// "94.4%" の自動許可率。
  var autoAllowPercentString: String? {
    guard total > 0 else { return nil }
    let pct = Double(byDecision.allow) / Double(total) * 100.0
    return String(format: "%.1f%%", pct)
  }

  /// "median 17.1s / mean 51.4s" のような人間応答時間。
  var humanLatencyString: String? {
    guard humanResponse.count > 0 else { return nil }
    func format(_ ms: Double?) -> String {
      guard let ms = ms else { return "—" }
      if ms < 1000 { return "\(Int(ms))ms" }
      if ms < 60_000 { return String(format: "%.1fs", ms / 1000) }
      return String(format: "%.1fm", ms / 60_000)
    }
    return "median \(format(humanResponse.p50)) · p95 \(format(humanResponse.p95))"
  }
}

/// daemon の `Message` (shared/src/message.ts) と対応する Swift モデル。
/// 人間 → Claude の reply text。
struct Message: Identifiable, Hashable {
  let id: String
  let sessionId: String
  let body: String
  let createdAt: Date
  /// drain されて Claude に届けられた時刻。未配送なら nil。
  let deliveredAt: Date?

  init(id: String, sessionId: String, body: String, createdAt: Date, deliveredAt: Date?) {
    self.id = id
    self.sessionId = sessionId
    self.body = body
    self.createdAt = createdAt
    self.deliveredAt = deliveredAt
  }

  init?(dict: [String: Any]) {
    guard
      let id = dict["id"] as? String,
      let sessionId = dict["session_id"] as? String,
      let body = dict["body"] as? String,
      let createdMs = (dict["created_at"] as? NSNumber)?.doubleValue
    else {
      return nil
    }
    let deliveredAt: Date? = {
      guard let n = dict["delivered_at"] as? NSNumber else { return nil }
      return Date(timeIntervalSince1970: n.doubleValue / 1000.0)
    }()
    self.id = id
    self.sessionId = sessionId
    self.body = body
    self.createdAt = Date(timeIntervalSince1970: createdMs / 1000.0)
    self.deliveredAt = deliveredAt
  }

  var isDelivered: Bool { deliveredAt != nil }
}
