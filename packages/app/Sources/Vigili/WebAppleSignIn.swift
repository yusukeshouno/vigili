import AppKit
import AuthenticationServices
import CryptoKit
import Foundation

/// Mac (Developer ID 配布) 用の Web Sign in with Apple フロー (SPEC §10.5)。
///
/// Developer ID プロファイルは `com.apple.developer.applesignin` を認可できず、
/// ネイティブ `ASAuthorizationController` を使うと AMFI が起動を拒否する。そこで
/// entitlement 不要の `ASWebAuthenticationSession` で appleid.apple.com の OAuth を開く。
///
/// フロー:
///   1. state + nonce を生成し authorize URL を組む (client_id = Services ID)
///   2. ASWebAuthenticationSession で開く (callbackURLScheme: "vigili")
///   3. Apple → relay の web-callback へ form_post → relay が検証して session 発行
///   4. relay が vigili://auth-callback?session=&account_id=&email=&state= へ 302
///   5. session を読み出して返す (state 一致を確認)
@MainActor
final class WebAppleSignIn: NSObject {
  struct Result {
    let sessionToken: String
    let accountId: String
    let email: String?
  }

  enum SignInError: LocalizedError {
    case cancelled
    case callbackInvalid
    case stateMismatch
    case relayError(String)

    var errorDescription: String? {
      switch self {
      case .cancelled: return "サインインがキャンセルされました"
      case .callbackInvalid: return "Apple からの応答を解釈できませんでした"
      case .stateMismatch: return "state 不一致 (セッションの起動元が一致しません)"
      case .relayError(let r): return "relay エラー: \(r)"
      }
    }
  }

  /// Apple の Web Sign in 設定 (SPEC §10.5)。
  private static let servicesId = "io.vigili.signin"
  private static let redirectUri = "https://relay.vigili.io/v1/auth/apple/web-callback"
  private static let authorizeEndpoint = "https://appleid.apple.com/auth/authorize"
  private static let callbackScheme = "vigili"

  private var session: ASWebAuthenticationSession?

  func signIn() async throws -> Result {
    let state = Self.randomToken()
    let nonce = Self.randomToken()
    guard let authURL = Self.buildAuthorizeURL(state: state, nonce: nonce) else {
      throw SignInError.callbackInvalid
    }

    let callbackURL: URL = try await withCheckedThrowingContinuation { cont in
      let s = ASWebAuthenticationSession(
        url: authURL,
        callbackURLScheme: Self.callbackScheme,
      ) { url, error in
        if let url = url {
          cont.resume(returning: url)
        } else if let asError = error as? ASWebAuthenticationSessionError,
          asError.code == .canceledLogin
        {
          cont.resume(throwing: SignInError.cancelled)
        } else {
          cont.resume(throwing: error ?? SignInError.callbackInvalid)
        }
      }
      s.presentationContextProvider = self
      // Apple の Cookie を共有して「以前サインインした Apple ID」を使えるようにする。
      s.prefersEphemeralWebBrowserSession = false
      self.session = s
      if !s.start() {
        cont.resume(throwing: SignInError.callbackInvalid)
      }
    }

    return try Self.parseCallback(callbackURL, expectedState: state)
  }

  /// vigili://auth-callback?session=&account_id=&email=&state= を解釈する。
  static func parseCallback(_ url: URL, expectedState: String) throws -> Result {
    guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      throw SignInError.callbackInvalid
    }
    let items = comps.queryItems ?? []
    func q(_ name: String) -> String? { items.first { $0.name == name }?.value }

    if let err = q("error") { throw SignInError.relayError(err) }
    // state は CSRF / 起動元バインド。relay が往復させた値と一致させる。
    guard q("state") == expectedState else { throw SignInError.stateMismatch }
    guard let session = q("session"), !session.isEmpty,
      let accountId = q("account_id"), !accountId.isEmpty
    else { throw SignInError.callbackInvalid }
    return Result(sessionToken: session, accountId: accountId, email: q("email"))
  }

  /// authorize URL を組む。response_mode=form_post (scope に email を含むため必須)。
  static func buildAuthorizeURL(state: String, nonce: String) -> URL? {
    var comps = URLComponents(string: authorizeEndpoint)
    comps?.queryItems = [
      URLQueryItem(name: "client_id", value: servicesId),
      URLQueryItem(name: "redirect_uri", value: redirectUri),
      URLQueryItem(name: "response_type", value: "code id_token"),
      URLQueryItem(name: "response_mode", value: "form_post"),
      URLQueryItem(name: "scope", value: "email"),
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "nonce", value: nonce),
    ]
    return comps?.url
  }

  private static func randomToken(byteCount: Int = 24) -> String {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    if SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes) != errSecSuccess {
      return UUID().uuidString.replacingOccurrences(of: "-", with: "")
    }
    return Data(bytes).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}

extension WebAppleSignIn: ASWebAuthenticationPresentationContextProviding {
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    NSApplication.shared.keyWindow
      ?? NSApplication.shared.windows.first
      ?? ASPresentationAnchor()
  }
}
