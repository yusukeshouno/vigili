import Foundation

/// iOS 側の永続設定 (daemon URL + token)。
///
/// 単一デバイス想定なので UserDefaults で十分。Keychain 化は将来の課題。
/// (UserDefaults はアプリ専用なので他アプリから直接見えないが iCloud Sync は無効化。)
enum MobileSettings {
  private enum Key {
    static let daemonUrl = "sentinel.daemonUrl"
    static let token = "sentinel.token"
  }

  static var daemonUrl: String {
    get { UserDefaults.standard.string(forKey: Key.daemonUrl) ?? "" }
    set { UserDefaults.standard.set(newValue, forKey: Key.daemonUrl) }
  }

  static var token: String {
    get { UserDefaults.standard.string(forKey: Key.token) ?? "" }
    set { UserDefaults.standard.set(newValue, forKey: Key.token) }
  }

  /// `daemonUrl` を WebSocket 用 URL に変換する。
  ///
  /// - スキーム未指定 → 数字始まりなら `ws://` (LAN IP)、ホスト名なら `wss://` (Tailscale 等 HTTPS)
  /// - ポート未指定 + http/ws → `:7878` (daemon の標準ポート) を補う
  /// - ポート未指定 + https/wss → :443 のまま (Tailscale Serve / Cloud Edition 経由想定)
  /// - http → ws、https → wss にスキーム書き換え
  static var wsUrlBase: URL? {
    var s = daemonUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.isEmpty { return nil }
    if !s.contains("://") {
      let isLikelyIp = s.first.map { $0.isNumber } ?? false
      s = (isLikelyIp ? "http://" : "https://") + s
    }
    guard let comp = URLComponents(string: s) else { return nil }
    var c = comp
    switch c.scheme {
    case "http": c.scheme = "ws"
    case "https": c.scheme = "wss"
    case "ws", "wss": break
    default: return nil
    }
    // ポート未指定で ws (LAN) なら daemon 標準の :7878 を補う。
    // wss (https) 経路は Tailscale Serve / 商用 Relay が :443 終端する前提なので触らない。
    if c.port == nil, c.scheme == "ws" {
      c.port = 7878
    }
    return c.url
  }

  static var isConfigured: Bool {
    wsUrlBase != nil && !token.isEmpty
  }

  static func clear() {
    UserDefaults.standard.removeObject(forKey: Key.daemonUrl)
    UserDefaults.standard.removeObject(forKey: Key.token)
  }
}
