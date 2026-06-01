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

  // MARK: - promote ペイロード生成

  /// "今後は自動で承認" ボタン用の promote ペイロードを生成する。
  /// Mac / iOS どちらからも呼べるよう、共有モデルに置く。
  func buildPromotePayload() -> [String: Any] {
    var match: [String: Any] = ["tool": toolName]
    var nameParts: [String] = []

    switch toolName {
    case "Bash":
      if let cmd = toolInput["command"] as? String {
        let escaped = NSRegularExpression.escapedPattern(for: cmd)
        match["command_matches"] = "^\(escaped)$"
        let clean = String(cmd.prefix(32))
          .components(separatedBy: CharacterSet.alphanumerics.inverted)
          .filter { !$0.isEmpty }
          .joined(separator: "-")
          .lowercased()
        nameParts = ["bash", clean.isEmpty ? "cmd" : clean]
      } else {
        nameParts = ["bash"]
      }
    case "Edit", "Write":
      let path = (toolInput["file_path"] as? String)
        ?? (toolInput["path"] as? String) ?? ""
      if !path.isEmpty {
        let escaped = NSRegularExpression.escapedPattern(for: path)
        match["path_matches"] = "^\(escaped)$"
        let base = URL(fileURLWithPath: path).lastPathComponent
          .components(
            separatedBy: CharacterSet.alphanumerics
              .union(CharacterSet(charactersIn: "._-")).inverted
          )
          .joined(separator: "-")
          .lowercased()
        nameParts = [toolName.lowercased(), base.isEmpty ? "file" : base]
      } else {
        nameParts = [toolName.lowercased()]
      }
    case "WebFetch":
      if let urlStr = toolInput["url"] as? String,
         let url = URL(string: urlStr),
         let host = url.host {
        let escaped = NSRegularExpression.escapedPattern(for: host)
        match["url_matches"] = escaped
        let cleanHost = host
          .components(
            separatedBy: CharacterSet.alphanumerics
              .union(CharacterSet(charactersIn: ".-")).inverted
          )
          .joined(separator: "-")
          .lowercased()
        nameParts = ["fetch", cleanHost.isEmpty ? "url" : cleanHost]
      } else {
        nameParts = ["fetch"]
      }
    default:
      nameParts = [toolName.lowercased()]
    }

    // プロジェクトスコープ: sessionTag があればそのプロジェクト専用ルールにする
    if let tag = sessionTag, !tag.isEmpty {
      match["repo_in"] = [tag]
      // プロジェクト名を rule 名に含める
      let cleanTag = tag
        .components(separatedBy: CharacterSet.alphanumerics.inverted)
        .filter { !$0.isEmpty }
        .joined(separator: "-")
        .lowercased()
        .prefix(20)
      nameParts.insert(String(cleanTag), at: 0)
    }

    // 名前衝突防止のため末尾に短いタイムスタンプを付ける
    let ts = String(Int(Date().timeIntervalSince1970) % 100_000)
    let ruleName = "auto-allow-" + (nameParts + [ts]).joined(separator: "-")
    return ["rule_name": ruleName, "match": match]
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

extension Sequence where Element == ApprovalRequest {
  /// pending スタックの並び順 = 新しい順 (createdAt 降順)。最上段が最新の ask。
  /// Mac popover / iOS queue の cardList・actionsBar で同じ並びを使うため共有に置く。
  var newestFirst: [ApprovalRequest] {
    sorted { $0.createdAt > $1.createdAt }
  }
}

/// daemon の `StatsBuckets` (db/stats.ts) と対応する Swift モデル。
struct StatsBuckets {
  struct ByDecision {
    let allow: Int
    let deny: Int
    /// 外部要因による cancel（Claude Code dialog で承認済み等）。deny にはカウントしない。
    let cancelled: Int
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
    let cancelledC = (bd["cancelled"] as? NSNumber)?.intValue ?? 0
    self.byDecision = ByDecision(allow: allow, deny: deny, cancelled: cancelledC, pending: pendingC)
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

// MARK: -

/// 1 日分の統計バケット。WS `stats` メッセージの `week` 配列要素。
/// index 0 = 今日、index 6 = 7 日前。
struct DailyBucket: Identifiable {
  let date: String  // "YYYY-MM-DD"
  let stats: StatsBuckets
  var id: String { date }

  /// Vigili が自動処理した件数 (allow - 人間承認)。
  var auto: Int {
    let human = (stats.bySource["human-pwa"] ?? 0) + (stats.bySource["human-cli"] ?? 0)
    return max(0, stats.byDecision.allow - human)
  }
  /// 人間が明示承認した件数。
  var humanApproved: Int {
    (stats.bySource["human-pwa"] ?? 0) + (stats.bySource["human-cli"] ?? 0)
  }
  /// ブロックした件数。
  var denied: Int { stats.byDecision.deny }
  /// 総件数 (auto + human + denied + cancelled 等)。
  var total: Int { stats.total }

  init?(dict: [String: Any]) {
    guard
      let date = dict["date"] as? String,
      let parsed = StatsBuckets(dict: dict)
    else { return nil }
    self.date = date
    self.stats = parsed
  }

  /// 曜日の短縮形 ("M" "T" "W" "T" "F" "S" "S")。
  var weekdayLetter: String {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    guard let d = formatter.date(from: date) else { return "?" }
    let cal = Calendar.current
    let weekday = cal.component(.weekday, from: d)
    // Sun=1, Mon=2 ... Sat=7 → "S","M","T","W","T","F","S"
    let letters = ["S", "M", "T", "W", "T", "F", "S"]
    let idx = weekday - 1
    return (idx >= 0 && idx < letters.count) ? letters[idx] : "?"
  }
}

/// daemon の `PolicyRule` (shared/src/policy.ts) と対応する Swift モデル。
/// when の各フィールドを一行サマリーに変換して表示に使う。
struct PolicyRule: Identifiable {
  let name: String
  let action: String  // "allow" | "deny" | "ask"
  let reason: String?
  /// when 条件を人間向けに 1 行にまとめたもの。
  let whenSummary: String
  /// expires_at (ISO 8601) をパースした日付。nil = 無期限。
  let expiresAt: Date?

  var id: String { name }

  /// 期限切れかどうか。
  var isExpired: Bool {
    guard let exp = expiresAt else { return false }
    return exp < Date()
  }

  /// 残り時間の表示文字列。24時間以内なら時間/分単位。
  var expiryLabel: String? {
    guard let exp = expiresAt else { return nil }
    let now = Date()
    if exp < now { return "期限切れ" }
    let interval = exp.timeIntervalSince(now)
    let totalMinutes = Int(interval / 60)
    if totalMinutes < 1 { return "まもなく失効" }
    if totalMinutes < 60 { return "\(totalMinutes)分後に失効" }
    let hours = totalMinutes / 60
    if hours < 24 { return "\(hours)時間後に失効" }
    return "\(hours / 24)日後に失効"
  }

  init?(dict: [String: Any]) {
    guard
      let name = dict["name"] as? String,
      let action = dict["action"] as? String,
      let when = dict["when"] as? [String: Any]
    else { return nil }
    self.name = name
    self.action = action
    self.reason = dict["reason"] as? String
    self.whenSummary = Self.summarize(when: when)
    if let expiresStr = dict["expires_at"] as? String {
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      self.expiresAt = formatter.date(from: expiresStr)
        ?? ISO8601DateFormatter().date(from: expiresStr)
    } else {
      self.expiresAt = nil
    }
  }

  private static func summarize(when: [String: Any]) -> String {
    var parts: [String] = []
    if let tool = when["tool"] {
      if let arr = tool as? [String] { parts.append("tool: \(arr.joined(separator: "|"))") }
      else if let s = tool as? String { parts.append("tool: \(s)") }
    }
    if let v = when["command_matches"] as? String { parts.append("cmd ≈ /\(v)/") }
    if let v = when["path_matches"] as? String { parts.append("path ≈ /\(v)/") }
    if let v = when["url_matches"] as? String { parts.append("url ≈ /\(v)/") }
    if let repos = when["repo_in"] as? [String] { parts.append("repo: \(repos.joined(separator: ", "))") }
    if let tb = when["time_between"] as? [String], tb.count == 2 { parts.append("\(tb[0])–\(tb[1])") }
    return parts.isEmpty ? "(any)" : parts.joined(separator: " · ")
  }
}

/// daemon の policy history item (admin "history" action) と対応する Swift モデル。
struct PolicyHistoryItem: Identifiable {
  let id: String
  let createdAt: Date
  let toolName: String
  let toolInputSummary: String
  let decision: String  // "allow" | "deny"
  let ruleName: String

  init?(dict: [String: Any]) {
    guard
      let id = dict["id"] as? String,
      let createdMs = (dict["created_at"] as? NSNumber)?.doubleValue,
      let toolName = dict["tool_name"] as? String,
      let summary = dict["tool_input_summary"] as? String,
      let decision = dict["decision"] as? String,
      let ruleName = dict["rule_name"] as? String
    else { return nil }
    self.id = id
    self.createdAt = Date(timeIntervalSince1970: createdMs / 1000.0)
    self.toolName = toolName
    self.toolInputSummary = summary
    self.decision = decision
    self.ruleName = ruleName
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

// MARK: - L4 ホスト型セッション (vigili run)

/// daemon の `HostedSession` (shared/session.ts) と対応する Swift モデル。
/// `vigili run` がホストする Claude Code セッションの公開ビュー。
struct HostedSession: Identifiable, Hashable {
  let sessionId: String
  let tag: String?
  let cwd: String
  /// "running" | "awaiting" | "ended"
  let status: String
  let startedAt: Date

  var id: String { sessionId }

  init(sessionId: String, tag: String?, cwd: String, status: String, startedAt: Date) {
    self.sessionId = sessionId
    self.tag = tag
    self.cwd = cwd
    self.status = status
    self.startedAt = startedAt
  }

  init?(dict: [String: Any]) {
    guard
      let sessionId = dict["session_id"] as? String,
      let cwd = dict["cwd"] as? String,
      let status = dict["status"] as? String,
      let startedMs = (dict["started_at"] as? NSNumber)?.doubleValue
    else { return nil }
    self.sessionId = sessionId
    self.tag = dict["tag"] as? String
    self.cwd = cwd
    self.status = status
    self.startedAt = Date(timeIntervalSince1970: startedMs / 1000.0)
  }

  /// 表示用の短いラベル (tag があればそれ、無ければ cwd の末尾)。
  var displayName: String {
    if let tag = tag, !tag.isEmpty { return tag }
    let base = URL(fileURLWithPath: cwd).lastPathComponent
    return base.isEmpty ? sessionId : base
  }
}

/// daemon の `TranscriptLine` (shared/session.ts) と対応する Swift モデル。
/// チャット UI の 1 吹き出しに相当する。
struct TranscriptLine: Identifiable, Hashable {
  /// 生成時に発番する安定 ID (ForEach 用)。
  let id: String
  /// "assistant" | "user" | "tool" | "system"
  let role: String
  let text: String
  let at: Date
  /// role=="tool" のときのツール名。
  let toolName: String?

  init(role: String, text: String, at: Date, toolName: String?, id: String = UUID().uuidString) {
    self.id = id
    self.role = role
    self.text = text
    self.at = at
    self.toolName = toolName
  }

  init?(dict: [String: Any]) {
    guard
      let role = dict["role"] as? String,
      let text = dict["text"] as? String,
      let atMs = (dict["at"] as? NSNumber)?.doubleValue
    else { return nil }
    self.id = UUID().uuidString
    self.role = role
    self.text = text
    self.at = Date(timeIntervalSince1970: atMs / 1000.0)
    self.toolName = dict["tool_name"] as? String
  }
}

/// AskUserQuestion の選択肢 1 つ (shared/session.ts QuestionOption)。
struct QuestionOption: Identifiable, Hashable {
  let label: String
  let description: String

  var id: String { label }

  init?(dict: [String: Any]) {
    guard
      let label = dict["label"] as? String,
      let description = dict["description"] as? String
    else { return nil }
    self.label = label
    self.description = description
  }
}

/// AskUserQuestion の質問 1 つ (shared/session.ts Question)。
struct Question: Identifiable, Hashable {
  let question: String
  let header: String
  let options: [QuestionOption]
  let multiSelect: Bool

  var id: String { question }

  init?(dict: [String: Any]) {
    guard
      let question = dict["question"] as? String,
      let header = dict["header"] as? String,
      let opts = dict["options"] as? [[String: Any]],
      let multiSelect = dict["multiSelect"] as? Bool
    else { return nil }
    self.question = question
    self.header = header
    self.options = opts.compactMap(QuestionOption.init(dict:))
    self.multiSelect = multiSelect
  }
}

/// WS `question` で fan-out された選択肢質問。request_id で回答を対応づける。
struct PendingQuestion: Identifiable, Hashable {
  let sessionId: String
  let requestId: String
  let questions: [Question]

  var id: String { requestId }

  init(sessionId: String, requestId: String, questions: [Question]) {
    self.sessionId = sessionId
    self.requestId = requestId
    self.questions = questions
  }
}

/// WS `plan` で fan-out された plan 承認待ち (ExitPlanMode)。
struct PendingPlan: Identifiable, Hashable {
  let sessionId: String
  let requestId: String
  let plan: String

  var id: String { requestId }

  init(sessionId: String, requestId: String, plan: String) {
    self.sessionId = sessionId
    self.requestId = requestId
    self.plan = plan
  }
}
