import Foundation

/// Vigili Cloud Relay の定数。
enum RelayConstants {
  /// relay の base URL。daemon の pair.ts デフォルトと揃える。
  static let base = "https://relay.vigili.io"

  /// relay として受け入れる唯一のホスト。
  /// deeplink/QR から渡された relay URL がこのホストかを必ず検証する
  /// (攻撃者が悪意ある relay に接続先を差し替えるのを防ぐ)。
  static let allowedHost = "relay.vigili.io"

  /// 与えられた文字列が「https://relay.vigili.io(:port)(/path)」形式かを検証する。
  /// - scheme は https のみ (平文 http は拒否)
  /// - host は allowedHost と完全一致 (サブドメイン偽装も拒否)
  static func isTrustedRelayURL(_ raw: String) -> Bool {
    guard let c = URLComponents(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
      c.scheme?.lowercased() == "https",
      let host = c.host?.lowercased(),
      host == allowedHost
    else { return false }
    return true
  }
}

struct RelaySession: Decodable {
  let token: String
  let expiresAt: Int
}

struct RelayAccount: Decodable {
  let id: String
  let email: String?
}

struct AppleAuthResponse: Decodable {
  let account: RelayAccount
  let session: RelaySession
}

struct PairingResponse: Decodable {
  let id: String
  let name: String?
  let agentKey: String
  let userToken: String
}

enum RelayAuthError: Error, LocalizedError {
  case http(Int, String)
  case invalidResponse

  var errorDescription: String? {
    switch self {
    case .http(let code, let body): return "relay HTTP \(code): \(body.prefix(200))"
    case .invalidResponse: return "relay 応答を解釈できませんでした"
    }
  }
}

/// relay の account 系 REST を叩く薄いクライアント (TS pair.ts の callRelay 相当)。
/// Mac / iOS 双方の Sign in with Apple フローから使う。
enum RelayAuthClient {
  /// POST /v1/auth/apple — Apple identity token を検証して session を得る。
  static func signInWithApple(
    relayBase: String = RelayConstants.base,
    identityToken: String,
    rawNonce: String,
  ) async throws -> AppleAuthResponse {
    try await postJson(
      relayBase: relayBase,
      path: "/v1/auth/apple",
      body: ["identity_token": identityToken, "nonce": rawNonce],
      bearer: nil,
    )
  }

  /// POST /v1/pairings — この Mac 用の pairing を作成 (agent_key / user_token を得る)。
  static func createPairing(
    relayBase: String = RelayConstants.base,
    sessionToken: String,
    name: String?,
  ) async throws -> PairingResponse {
    var body: [String: String] = [:]
    if let name = name, !name.isEmpty { body["name"] = name }
    return try await postJson(
      relayBase: relayBase, path: "/v1/pairings", body: body, bearer: sessionToken,
    )
  }

  /// POST /v1/account/devices — APNs device をアカウントに登録 (pairing 非依存)。
  static func registerAccountDevice(
    relayBase: String = RelayConstants.base,
    sessionToken: String,
    apnsToken: String,
    platform: String,
  ) async throws {
    let _: OkResponse = try await postJson(
      relayBase: relayBase,
      path: "/v1/account/devices",
      body: ["apns_token": apnsToken, "platform": platform],
      bearer: sessionToken,
    )
  }

  private struct OkResponse: Decodable {
    let ok: Bool?
  }

  private static func decoder() -> JSONDecoder {
    let d = JSONDecoder()
    d.keyDecodingStrategy = .convertFromSnakeCase
    return d
  }

  private static func postJson<T: Decodable>(
    relayBase: String,
    path: String,
    body: [String: String],
    bearer: String?,
  ) async throws -> T {
    let trimmed = relayBase.hasSuffix("/") ? String(relayBase.dropLast()) : relayBase
    guard let url = URL(string: trimmed + path) else { throw RelayAuthError.invalidResponse }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if let bearer = bearer { req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
    req.httpBody = try JSONSerialization.data(withJSONObject: body)

    let (data, response) = try await URLSession.shared.data(for: req)
    let code = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(code) else {
      throw RelayAuthError.http(code, String(data: data, encoding: .utf8) ?? "")
    }
    do {
      return try decoder().decode(T.self, from: data)
    } catch {
      throw RelayAuthError.invalidResponse
    }
  }
}
