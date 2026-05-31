import Foundation

/// Main app (Mac の `Sentinel` ターゲット) → Widget extension (`VigiliWidget`) の
/// 単方向データ受け渡し用ファイル。
///
/// 配置: widget のサンドボックスコンテナ内の `widget-state.json`
/// (`~/Library/Containers/io.vigili.app.shono.widget/Data/widget-state.json`)。
///
/// WidgetKit の TimelineProvider はアプリ本体のメモリにアクセスできない
/// (別プロセスで動く)。さらに macOS の widget extension は **App Sandbox 必須**で、
/// サンドボックス下では `~/.vigili/` を直読みできない。App Group も個人開発チームの
/// automatic signing では provisioning できなかった (wildcard profile が選ばれ
/// サンドボックスがコンテナ読み取りを deny する) ため、サンドボックスアプリが
/// entitlement 無しで常に読める「自分のコンテナ」を共有場所にし、非サンドボックスの
/// 本体がそこへ書き込む方式にした。詳細は SPEC.md §9.2。
///
/// 書き手 (Sentinel.app の AppCoordinator) は pending/stats が変わるたびに
/// `WidgetState.write(...)` を呼んでから `WidgetCenter.shared.reloadAllTimelines()` を叩く。
/// 読み手 (Widget) は TimelineProvider 内で `WidgetState.read()` で取り出す。
public struct WidgetState: Codable, Equatable, Sendable {
  /// 現在保留中の承認件数 (Allow/Deny 待ち)。
  public let pendingCount: Int
  /// 今日 (ローカル日付) の allow 件数。
  public let todayAllowCount: Int
  /// 今日 (ローカル日付) の deny 件数。
  public let todayDenyCount: Int
  /// daemon との接続状態。false なら widget 上で「offline」表示。
  public let connected: Bool
  /// このファイルが書かれた時刻 (UTC、ms)。stale 検知用。
  public let updatedAtMs: Int64
  /// 直近の pending request のタイトル (large widget の一覧表示用)。
  /// 順序は created_at asc (古い ask が先頭)。Privacy のため最大 5 件、各 60 文字まで。
  public let recentPending: [PendingItem]

  public struct PendingItem: Codable, Equatable, Sendable {
    /// 承認 ID (UUID)。tap で deeplink するため。
    public let id: String
    /// 表示用タイトル (例: "Bash · pnpm install")。
    public let title: String
    /// 経過秒 (作成からの)。
    public let ageSeconds: Int

    public init(id: String, title: String, ageSeconds: Int) {
      self.id = id
      self.title = title
      self.ageSeconds = ageSeconds
    }
  }

  public init(
    pendingCount: Int,
    todayAllowCount: Int,
    todayDenyCount: Int,
    connected: Bool,
    updatedAtMs: Int64,
    recentPending: [PendingItem]
  ) {
    self.pendingCount = pendingCount
    self.todayAllowCount = todayAllowCount
    self.todayDenyCount = todayDenyCount
    self.connected = connected
    self.updatedAtMs = updatedAtMs
    self.recentPending = recentPending
  }

  /// stale (widget が古いデータを描画している) と見なす閾値。
  /// 1 分以上 update が無ければ「offline / unknown」扱い。
  public static let staleThresholdSeconds: TimeInterval = 60

  /// 何も無い時のプレースホルダ。
  public static let placeholder = WidgetState(
    pendingCount: 0,
    todayAllowCount: 0,
    todayDenyCount: 0,
    connected: false,
    updatedAtMs: 0,
    recentPending: []
  )
}

// MARK: - cross-platform helpers

extension WidgetState {
  /// updatedAtMs が古ければ stale (offline 扱い)。
  public var isStale: Bool {
    guard updatedAtMs > 0 else { return true }
    let now = Date().timeIntervalSince1970 * 1000
    return (now - Double(updatedAtMs)) / 1000 > Self.staleThresholdSeconds
  }
}

// MARK: - macOS-only file IO
// iOS は ~/.vigili/ にアクセスできない (sandbox) ので、これらは macOS / Widget extension
// 限定。type 定義 (上記) は cross-platform で共有する。

#if os(macOS)
extension WidgetState {
  /// Widget extension の bundle id。host はこのコンテナへ書き、widget は自分のコンテナを読む。
  public static let widgetBundleIdentifier = "io.vigili.app.shono.widget"

  /// 配置先のファイル URL。優先順位:
  /// 1. `VIGILI_HOME`/`SENTINEL_HOME` env override（テスト・CLI 用）
  /// 2. widget のサンドボックスコンテナ
  ///    `~/Library/Containers/io.vigili.app.shono.widget/Data/widget-state.json`
  ///
  /// widget (サンドボックス) では `NSHomeDirectory()` が自分のコンテナ `Data` を指すので
  /// そのまま読める。host (非サンドボックス) では実ホーム配下の widget コンテナを明示パスで
  /// 指す。両者が同じ絶対パスを計算するため、provisioning / App Group なしで共有できる。
  public static var fileURL: URL {
    let env = ProcessInfo.processInfo.environment
    if let home = env["VIGILI_HOME"] ?? env["SENTINEL_HOME"] {
      return URL(fileURLWithPath: home).appendingPathComponent("widget-state.json")
    }
    let containerData: URL
    if Bundle.main.bundleIdentifier == widgetBundleIdentifier {
      // サンドボックス化した widget: NSHomeDirectory() == 自分のコンテナ Data ルート
      containerData = URL(fileURLWithPath: NSHomeDirectory())
    } else {
      // 非サンドボックスの host: 実ホーム配下の widget コンテナを明示パスで指す
      containerData = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent("Library/Containers/\(widgetBundleIdentifier)/Data")
    }
    return containerData.appendingPathComponent("widget-state.json")
  }

  /// Atomically write to disk.
  /// 失敗しても呼び元には握り潰す (widget 表示の優先度より app の動作を優先)。
  public func writeAtomically() {
    do {
      let data = try JSONEncoder().encode(self)
      let url = Self.fileURL
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true
      )
      try data.write(to: url, options: [.atomic])
    } catch {
      // log だけ。Console.app から `log show` で拾える。
      NSLog("[vigili-widget] writeAtomically failed: \(error.localizedDescription)")
    }
  }

  /// Widget extension から呼ぶ read。失敗時は placeholder を返す。
  public static func read() -> WidgetState {
    let url = fileURL
    guard FileManager.default.fileExists(atPath: url.path),
      let data = try? Data(contentsOf: url),
      let decoded = try? JSONDecoder().decode(WidgetState.self, from: data)
    else {
      return .placeholder
    }
    return decoded
  }

  // MARK: - widget → host 決定 (Allow/Deny)
  //
  // widget の Allow/Deny ボタン (App Intents) は daemon の unix socket に直接届かない
  // (サンドボックス)。そこで widget は自分のコンテナ下 decisions/<request_id>.json に
  // 決定を書き、非サンドボックスの host (AppCoordinator) が watch して daemon に適用する。
  // host→widget の widget-state.json と対称な、逆方向のコンテナファイル IPC。

  /// 決定受け渡しディレクトリ (widget コンテナ Data 下の decisions/)。
  /// `fileURL` と同じ要領で widget / host のどちらの process でも同じ絶対パスを返す。
  public static var decisionsDir: URL {
    let env = ProcessInfo.processInfo.environment
    if let home = env["VIGILI_HOME"] ?? env["SENTINEL_HOME"] {
      return URL(fileURLWithPath: home).appendingPathComponent("decisions", isDirectory: true)
    }
    let containerData: URL
    if Bundle.main.bundleIdentifier == widgetBundleIdentifier {
      containerData = URL(fileURLWithPath: NSHomeDirectory())
    } else {
      containerData = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent("Library/Containers/\(widgetBundleIdentifier)/Data")
    }
    return containerData.appendingPathComponent("decisions", isDirectory: true)
  }

  /// widget 側: Allow/Deny の決定を decisions/<id>.json に atomically 書く。
  public static func writeDecision(id: String, decision: String) {
    let dir = decisionsDir
    do {
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let url = dir.appendingPathComponent("\(id).json")
      let payload: [String: Any] = [
        "id": id,
        "decision": decision,
        "at": Int(Date().timeIntervalSince1970 * 1000),
      ]
      let data = try JSONSerialization.data(withJSONObject: payload)
      try data.write(to: url, options: [.atomic])
    } catch {
      NSLog("[vigili-widget] writeDecision failed: \(error.localizedDescription)")
    }
  }

  /// host 側: decisions/ 内の全決定を読み、(id, decision) を apply に渡してファイルを消す。
  /// decision は "allow" | "deny" のみ受け付ける。戻り値は適用件数。
  @discardableResult
  public static func drainDecisions(apply: (_ id: String, _ decision: String) -> Void) -> Int {
    let dir = decisionsDir
    let fm = FileManager.default
    guard let entries = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
    else {
      return 0
    }
    var count = 0
    for url in entries where url.pathExtension == "json" {
      guard
        let data = try? Data(contentsOf: url),
        let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let id = obj["id"] as? String,
        let decision = obj["decision"] as? String,
        decision == "allow" || decision == "deny"
      else {
        try? fm.removeItem(at: url)  // 壊れたファイルは消す
        continue
      }
      apply(id, decision)
      try? fm.removeItem(at: url)
      count += 1
    }
    return count
  }
}
#endif

/// MARK: - NSLog import shim (Foundation 経由で参照できるよう)
#if canImport(os)
  import os
#endif
