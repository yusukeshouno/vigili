import Foundation

/// APNs device token を relay に登録する薄い REST クライアント。
///
/// relay 経路が設定されているときだけ POST する (LAN only の運用では push は不要)。
/// 認証は WS client と同じ user_token (QR で受け取ったもの)。pairing は path の
/// :pid から取り、body には apns_token / platform だけを載せる。
///
/// 登録タイミングは 2 つ:
///   - 起動直後に APNs token を取得したとき (AppDelegate から register())
///   - 起動後に QR で relay を後付けしたとき (coordinator から reregisterIfPossible())
/// どちらでも最新の token を再送できるよう、直近 token を保持する。
enum RelayDeviceRegistrar {
  /// 直近で取得した APNs token。relay が後から設定された場合の再送に使う。
  private static var lastToken: String?

  /// AppDelegate が APNs token を取得したときに呼ぶ。
  static func register(apnsToken: String) {
    lastToken = apnsToken
    post(apnsToken: apnsToken)
  }

  /// relay credentials が後から入った (QR ペアリング) ときに呼ぶ。
  static func reregisterIfPossible() {
    guard let token = lastToken else { return }
    post(apnsToken: token)
  }

  private static func post(apnsToken: String) {
    guard
      let relay = MobileSettings.relayUrl?.trimmingCharacters(in: .whitespacesAndNewlines),
      !relay.isEmpty,
      let pid = MobileSettings.relayPid?.trimmingCharacters(in: .whitespacesAndNewlines),
      !pid.isEmpty,
      let userToken = MobileSettings.relayUserToken, !userToken.isEmpty
    else {
      Task { @MainActor in appLog("RelayDeviceRegistrar: relay 未設定、device 登録スキップ") }
      return
    }
    let base = relay.hasSuffix("/") ? String(relay.dropLast()) : relay
    guard let url = URL(string: "\(base)/v1/clients/\(pid)/devices") else { return }

    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("Bearer \(userToken)", forHTTPHeaderField: "Authorization")
    let body: [String: String] = ["apns_token": apnsToken, "platform": "ios"]
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)

    URLSession.shared.dataTask(with: req) { _, response, error in
      if let error = error {
        Task { @MainActor in appLog("RelayDeviceRegistrar: POST 失敗 \(error.localizedDescription)") }
        return
      }
      let code = (response as? HTTPURLResponse)?.statusCode ?? 0
      Task { @MainActor in
        if code == 200 || code == 201 {
          appLog("RelayDeviceRegistrar: device 登録成功")
        } else {
          appLog("RelayDeviceRegistrar: device 登録 status=\(code)")
        }
      }
    }.resume()
  }
}
