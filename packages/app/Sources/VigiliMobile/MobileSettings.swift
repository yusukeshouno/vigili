import Foundation

/// iOS 側の永続設定。
///
/// 2 経路を独立に保持:
///   - LAN 経路:   `lanUrl` + `lanToken` ("sentinel://setup" QR で書き込まれる)
///   - Relay 経路: `relayUrl` + `relayPid` + `relayUserToken` ("vigili://pair" QR)
///
/// MobileAppCoordinator が Bonjour 発見状況と組み合わせて「いま LAN を使うか
/// relay を使うか」を毎回選ぶ。両方とも有効でも問題ない (LAN を優先する戦略)。
///
/// 旧 `sentinel.daemonUrl` / `sentinel.token` のキーは migration して `lan*` に
/// 流し込む (初回読み出し時)。
enum MobileSettings {
  private enum Key {
    // LAN 経路
    static let lanUrl = "vigili.lan.url"      // "192.168.1.5:7878" or "mac.tail.ts.net" (scheme/port 自由)
    static let lanToken = "vigili.lan.token"

    // Relay 経路
    static let relayUrl = "vigili.relay.url"               // "https://relay.vigili.io"
    static let relayPid = "vigili.relay.pairing_id"        // UUID
    static let relayUserToken = "vigili.relay.user_token"

    // Account 経路 (Sign in with Apple)。session token は Keychain (UserDefaults ではない)。
    static let accountRelayUrl = "vigili.account.relay_url"  // "https://relay.vigili.io"

    // 旧設定 (migration source)
    static let legacyDaemonUrl = "sentinel.daemonUrl"
    static let legacyToken = "sentinel.token"
    static let migrated = "vigili.migrated.v1"
  }

  // MARK: - LAN

  static var lanUrl: String? {
    get {
      migrateLegacyIfNeeded()
      return UserDefaults.standard.string(forKey: Key.lanUrl)
    }
    set {
      if let v = newValue, !v.isEmpty {
        UserDefaults.standard.set(v, forKey: Key.lanUrl)
      } else {
        UserDefaults.standard.removeObject(forKey: Key.lanUrl)
      }
    }
  }

  /// LAN の access token。SECURITY: 認証情報なので Keychain に保存する
  /// (UserDefaults は平文 plist でデバイスバックアップから復元可能なため不可)。
  /// 旧バージョンが UserDefaults に書いた値は初回読み出し時に Keychain へ移行する。
  static var lanToken: String? {
    get {
      migrateLegacyIfNeeded()
      migrateTokenToKeychainIfNeeded(
        udKey: Key.lanToken, account: KeychainStore.lanTokenAccount)
      return KeychainStore.get(account: KeychainStore.lanTokenAccount)
    }
    set {
      if let v = newValue, !v.isEmpty {
        KeychainStore.set(v, account: KeychainStore.lanTokenAccount)
      } else {
        KeychainStore.delete(account: KeychainStore.lanTokenAccount)
      }
      // 旧 UserDefaults 値が残っていれば消す (二重保管しない)。
      UserDefaults.standard.removeObject(forKey: Key.lanToken)
    }
  }

  /// LAN 用の WS URL base を組み立てる (`ws://192.168.x.x:7878` 等)。
  ///
  /// - スキーム未指定 → 数字始まりなら `ws://`、ホスト名なら `wss://` (Tailscale 等 HTTPS)
  /// - ポート未指定 + ws → `:7878`、wss → :443 のまま
  /// - http → ws、https → wss
  /// - DaemonWsClient 側で末尾に `/ws` が自動付与される
  static var lanWsUrlBase: URL? {
    guard var s = lanUrl?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else {
      return nil
    }
    if !s.contains("://") {
      let isLikelyIp = s.first.map { $0.isNumber } ?? false
      s = (isLikelyIp ? "http://" : "https://") + s
    }
    guard var c = URLComponents(string: s) else { return nil }
    switch c.scheme {
    case "http": c.scheme = "ws"
    case "https": c.scheme = "wss"
    case "ws", "wss": break
    default: return nil
    }
    if c.port == nil, c.scheme == "ws" {
      c.port = 7878
    }
    return c.url
  }

  static var hasLan: Bool { lanUrl != nil && lanToken != nil && !lanToken!.isEmpty }

  // MARK: - Relay

  static var relayUrl: String? {
    get {
      migrateLegacyIfNeeded()
      return UserDefaults.standard.string(forKey: Key.relayUrl)
    }
    set {
      if let v = newValue, !v.isEmpty {
        UserDefaults.standard.set(v, forKey: Key.relayUrl)
      } else {
        UserDefaults.standard.removeObject(forKey: Key.relayUrl)
      }
    }
  }

  static var relayPid: String? {
    get {
      migrateLegacyIfNeeded()
      return UserDefaults.standard.string(forKey: Key.relayPid)
    }
    set {
      if let v = newValue, !v.isEmpty {
        UserDefaults.standard.set(v, forKey: Key.relayPid)
      } else {
        UserDefaults.standard.removeObject(forKey: Key.relayPid)
      }
    }
  }

  /// legacy relay (QR pairing) の user_token。SECURITY: 認証情報なので Keychain に保存。
  static var relayUserToken: String? {
    get {
      migrateLegacyIfNeeded()
      migrateTokenToKeychainIfNeeded(
        udKey: Key.relayUserToken, account: KeychainStore.relayUserTokenAccount)
      return KeychainStore.get(account: KeychainStore.relayUserTokenAccount)
    }
    set {
      if let v = newValue, !v.isEmpty {
        KeychainStore.set(v, account: KeychainStore.relayUserTokenAccount)
      } else {
        KeychainStore.delete(account: KeychainStore.relayUserTokenAccount)
      }
      UserDefaults.standard.removeObject(forKey: Key.relayUserToken)
    }
  }

  /// Relay 用の WS URL を組み立てる。
  /// 形式: `wss://<relay>/v1/clients/<pid>` (DaemonWsClient が `/ws` を足さず使う)
  static var relayWsUrl: URL? {
    guard let base = relayUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
      !base.isEmpty,
      let pid = relayPid?.trimmingCharacters(in: .whitespacesAndNewlines),
      !pid.isEmpty
    else { return nil }
    let trimmed = base.hasSuffix("/") ? String(base.dropLast()) : base
    let wsBase: String
    if trimmed.hasPrefix("https://") {
      wsBase = "wss://" + trimmed.dropFirst("https://".count)
    } else if trimmed.hasPrefix("http://") {
      wsBase = "ws://" + trimmed.dropFirst("http://".count)
    } else {
      wsBase = trimmed  // assume already ws:// / wss://
    }
    return URL(string: "\(wsBase)/v1/clients/\(pid)")
  }

  static var hasRelay: Bool {
    relayUrl != nil && relayPid != nil && relayUserToken != nil
      && !(relayUserToken ?? "").isEmpty
  }

  // MARK: - Account (Sign in with Apple)

  static var accountRelayUrl: String? {
    get { UserDefaults.standard.string(forKey: Key.accountRelayUrl) }
    set {
      if let v = newValue, !v.isEmpty {
        UserDefaults.standard.set(v, forKey: Key.accountRelayUrl)
      } else {
        UserDefaults.standard.removeObject(forKey: Key.accountRelayUrl)
      }
    }
  }

  /// relay の session token (Keychain 保管。UserDefaults には置かない)。
  static var accountSessionToken: String? {
    get { KeychainStore.get(account: KeychainStore.sessionTokenAccount) }
    set {
      if let v = newValue, !v.isEmpty {
        KeychainStore.set(v, account: KeychainStore.sessionTokenAccount)
      } else {
        KeychainStore.delete(account: KeychainStore.sessionTokenAccount)
      }
    }
  }

  static var hasAccount: Bool {
    !(accountRelayUrl ?? "").isEmpty && !(accountSessionToken ?? "").isEmpty
  }

  /// account stream の WS URL。形式: `wss://<relay>/v1/account/stream`
  /// (token は DaemonWsClient が ?token= で付ける。`/ws` は付与されない)。
  static var accountWsUrl: URL? {
    guard let base = accountRelayUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
      !base.isEmpty
    else { return nil }
    let trimmed = base.hasSuffix("/") ? String(base.dropLast()) : base
    let wsBase: String
    if trimmed.hasPrefix("https://") {
      wsBase = "wss://" + trimmed.dropFirst("https://".count)
    } else if trimmed.hasPrefix("http://") {
      wsBase = "ws://" + trimmed.dropFirst("http://".count)
    } else {
      wsBase = trimmed
    }
    return URL(string: "\(wsBase)/v1/account/stream")
  }

  // MARK: - Aggregate / migration

  /// 何かしら 1 経路でも設定されていれば configured とみなす。
  static var isConfigured: Bool { hasLan || hasRelay || hasAccount }

  /// 旧 `sentinel.daemonUrl` / `sentinel.token` を `lan*` にコピーする (1 回だけ)。
  /// 移行後は migrated フラグを立てて再実行しない。
  private static func migrateLegacyIfNeeded() {
    let ud = UserDefaults.standard
    if ud.bool(forKey: Key.migrated) { return }
    if let oldUrl = ud.string(forKey: Key.legacyDaemonUrl),
      let oldToken = ud.string(forKey: Key.legacyToken),
      !oldUrl.isEmpty, !oldToken.isEmpty
    {
      // 既に新キーに何か入ってたら上書きしない (人間が再 setup した可能性)
      if ud.string(forKey: Key.lanUrl) == nil {
        ud.set(oldUrl, forKey: Key.lanUrl)
        ud.set(oldToken, forKey: Key.lanToken)
      }
    }
    ud.set(true, forKey: Key.migrated)
  }

  /// 旧バージョンが UserDefaults に平文保存していたトークンを Keychain へ移行する。
  /// Keychain に既に値があれば何もしない。移行後は UserDefaults 側を削除する。
  private static func migrateTokenToKeychainIfNeeded(udKey: String, account: String) {
    let ud = UserDefaults.standard
    guard let legacy = ud.string(forKey: udKey), !legacy.isEmpty else { return }
    if KeychainStore.get(account: account) == nil {
      KeychainStore.set(legacy, account: account)
    }
    ud.removeObject(forKey: udKey)
  }

  static func clear() {
    let ud = UserDefaults.standard
    for k in [
      Key.lanUrl, Key.lanToken, Key.relayUrl, Key.relayPid, Key.relayUserToken,
      Key.accountRelayUrl, Key.legacyDaemonUrl, Key.legacyToken,
    ] {
      ud.removeObject(forKey: k)
    }
    KeychainStore.delete(account: KeychainStore.sessionTokenAccount)
    KeychainStore.delete(account: KeychainStore.sessionExpiresAccount)
    KeychainStore.delete(account: KeychainStore.lanTokenAccount)
    KeychainStore.delete(account: KeychainStore.relayUserTokenAccount)
    // migrated フラグは残す (再 migration 不要)
  }

  static func clearLan() {
    let ud = UserDefaults.standard
    ud.removeObject(forKey: Key.lanUrl)
    ud.removeObject(forKey: Key.lanToken)
    KeychainStore.delete(account: KeychainStore.lanTokenAccount)
  }

  static func clearRelay() {
    let ud = UserDefaults.standard
    ud.removeObject(forKey: Key.relayUrl)
    ud.removeObject(forKey: Key.relayPid)
    ud.removeObject(forKey: Key.relayUserToken)
    KeychainStore.delete(account: KeychainStore.relayUserTokenAccount)
  }

  static func clearAccount() {
    UserDefaults.standard.removeObject(forKey: Key.accountRelayUrl)
    KeychainStore.delete(account: KeychainStore.sessionTokenAccount)
    KeychainStore.delete(account: KeychainStore.sessionExpiresAccount)
  }
}
