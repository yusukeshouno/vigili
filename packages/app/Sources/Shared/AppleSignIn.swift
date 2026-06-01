import AuthenticationServices
import CryptoKit
import Foundation

#if os(macOS)
  import AppKit
#else
  import UIKit
#endif

/// Sign in with Apple の結果。relay の `/v1/auth/apple` に identityToken + rawNonce を送る。
struct AppleSignInResult {
  let identityToken: String
  let rawNonce: String
  let userId: String
  let email: String?
}

enum AppleSignInError: Error, LocalizedError {
  case cancelledOrFailed(String)
  case missingIdentityToken

  var errorDescription: String? {
    switch self {
    case .cancelledOrFailed(let m): return "Apple サインインに失敗: \(m)"
    case .missingIdentityToken: return "Apple identity token を取得できませんでした"
    }
  }
}

/// `ASAuthorizationController` を async/await でラップした Sign in with Apple フロー。
///
/// nonce 契約: rawNonce を生成し `request.nonce = sha256(rawNonce)` を Apple に渡す。
/// Apple はその値を token の nonce クレームに載せて返すので、relay は sha256(rawNonce) と
/// 突き合わせて検証する。rawNonce はそのまま relay に送る。
@MainActor
final class AppleSignInCoordinator: NSObject {
  private var continuation: CheckedContinuation<AppleSignInResult, Error>?
  private var currentRawNonce = ""

  func signIn() async throws -> AppleSignInResult {
    let rawNonce = Self.randomNonce()
    currentRawNonce = rawNonce
    let request = ASAuthorizationAppleIDProvider().createRequest()
    request.requestedScopes = [.fullName, .email]
    request.nonce = Self.sha256(rawNonce)

    return try await withCheckedThrowingContinuation { cont in
      self.continuation = cont
      let controller = ASAuthorizationController(authorizationRequests: [request])
      controller.delegate = self
      controller.presentationContextProvider = self
      controller.performRequests()
    }
  }

  private static func randomNonce(byteCount: Int = 32) -> String {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    if SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes) != errSecSuccess {
      // 極めて稀: UUID 連結でフォールバック (一意性確保が主目的)
      return (UUID().uuidString + UUID().uuidString).replacingOccurrences(of: "-", with: "")
    }
    return Data(bytes).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  private static func sha256(_ input: String) -> String {
    SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}

extension AppleSignInCoordinator: ASAuthorizationControllerDelegate {
  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization,
  ) {
    guard
      let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
      let tokenData = cred.identityToken,
      let token = String(data: tokenData, encoding: .utf8)
    else {
      continuation?.resume(throwing: AppleSignInError.missingIdentityToken)
      continuation = nil
      return
    }
    let result = AppleSignInResult(
      identityToken: token,
      rawNonce: currentRawNonce,
      userId: cred.user,
      email: cred.email,
    )
    continuation?.resume(returning: result)
    continuation = nil
  }

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithError error: Error,
  ) {
    continuation?.resume(throwing: AppleSignInError.cancelledOrFailed(error.localizedDescription))
    continuation = nil
  }
}

extension AppleSignInCoordinator: ASAuthorizationControllerPresentationContextProviding {
  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    #if os(macOS)
      return NSApplication.shared.keyWindow
        ?? NSApplication.shared.windows.first
        ?? ASPresentationAnchor()
    #else
      let scene = UIApplication.shared.connectedScenes
        .first { $0.activationState == .foregroundActive } as? UIWindowScene
      return scene?.keyWindow ?? scene?.windows.first ?? UIWindow()
    #endif
  }
}
