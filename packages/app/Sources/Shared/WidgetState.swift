import Foundation

/// Main app (Mac の `Sentinel` ターゲット) → Widget extension (`VigiliWidget`) の
/// 単方向データ受け渡し用ファイル。
///
/// 配置: `~/.vigili/widget-state.json`
///
/// WidgetKit の TimelineProvider はアプリ本体のメモリにアクセスできない
/// (別プロセスで動く)。App Group + UserDefaults を使う手もあるが、
/// 商用前なので code-signing entitlement を増やしたくない。
/// ファイル経由なら同一ユーザ・同一 sandbox=false の前提で双方が読める。
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

extension WidgetState {
  /// 配置先のファイル URL。
  /// `VIGILI_HOME` env override に従い、無ければ `~/.vigili/widget-state.json`。
  /// リブランド過渡期: `~/.vigili` が無く `~/.sentinel` がある場合は後者を使う。
  public static var fileURL: URL {
    let env = ProcessInfo.processInfo.environment
    if let home = env["VIGILI_HOME"] ?? env["SENTINEL_HOME"] {
      return URL(fileURLWithPath: home).appendingPathComponent("widget-state.json")
    }
    let home = FileManager.default.homeDirectoryForCurrentUser
    let vigili = home.appendingPathComponent(".vigili")
    let sentinel = home.appendingPathComponent(".sentinel")
    let base =
      FileManager.default.fileExists(atPath: vigili.path)
        ? vigili
        : (FileManager.default.fileExists(atPath: sentinel.path) ? sentinel : vigili)
    return base.appendingPathComponent("widget-state.json")
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

  /// updatedAtMs が古ければ stale (offline 扱い)。
  public var isStale: Bool {
    guard updatedAtMs > 0 else { return true }
    let now = Date().timeIntervalSince1970 * 1000
    return (now - Double(updatedAtMs)) / 1000 > Self.staleThresholdSeconds
  }
}

/// MARK: - NSLog import shim (Foundation 経由で参照できるよう)
#if canImport(os)
  import os
#endif
