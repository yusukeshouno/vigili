import Foundation
import Security

/// relay の session token のような認証クレデンシャルを Keychain に保管する薄いラッパ。
///
/// UserDefaults はクレデンシャルの保存先として不適切なので、generic password として
/// Keychain に入れる。`kSecAttrAccessibleAfterFirstUnlock` で「再起動後の最初のアンロック以降」
/// 読めるようにする (APNs push でアプリが起こされた直後でも読めるように)。
///
/// アクセスグループは付けない (Personal Team でも問題が出ないよう、アプリローカルに閉じる)。
/// Widget / Live Activity 拡張は session token を必要としないので共有も不要。
enum KeychainStore {
  static let service = "io.vigili.session"

  /// relay の session token (`/v1/auth/apple` 等で受け取る Bearer)。
  static let sessionTokenAccount = "relay.session.token"
  /// session の expires_at (秒)。表示・期限判定用 (ベストエフォート)。
  static let sessionExpiresAccount = "relay.session.expires"

  @discardableResult
  static func set(_ value: String, account: String) -> Bool {
    let base: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(base as CFDictionary)
    var attrs = base
    attrs[kSecValueData as String] = Data(value.utf8)
    attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    return SecItemAdd(attrs as CFDictionary, nil) == errSecSuccess
  }

  static func get(account: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let data = item as? Data,
      let str = String(data: data, encoding: .utf8)
    else { return nil }
    return str
  }

  static func delete(account: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
  }
}
