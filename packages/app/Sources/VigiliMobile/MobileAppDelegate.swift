import UIKit
import UserNotifications

/// iOS の APNs 登録 + リモート通知ハンドリング。
///
/// なぜ必要か:
///   off-LAN でアプリがバックグラウンドだと iOS は WebSocket をサスペンドするため、
///   承認待ち (pending) が端末に届かない。relay から APNs push を送って端末を起こす
///   のが唯一の経路 (詳細は relay/src/apns.ts)。本 AppDelegate はその受け口:
///     1. 起動時に通知許可を要求し registerForRemoteNotifications を呼ぶ
///     2. APNs device token を取得したら relay の /v1/clients/:pid/devices に登録
///     3. 通知タップで前面化したら WS を即再接続させる (coordinator が購読)
final class MobileAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil,
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    requestAuthorizationAndRegister()
    return true
  }

  /// 通知許可を求め、許可されたら APNs 登録を開始する。
  /// 既に許可済みなら requestAuthorization は即 granted=true を返す。
  func requestAuthorizationAndRegister() {
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
      if let error = error {
        Task { @MainActor in appLog("APNs 許可要求エラー: \(error.localizedDescription)") }
      }
      guard granted else {
        Task { @MainActor in appLog("APNs 通知が許可されなかった") }
        return
      }
      Task { @MainActor in
        UIApplication.shared.registerForRemoteNotifications()
      }
    }
  }

  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data,
  ) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    Task { @MainActor in appLog("APNs device token 取得 (\(hex.count) hex)") }
    RelayDeviceRegistrar.register(apnsToken: hex)
  }

  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error,
  ) {
    Task { @MainActor in appLog("APNs 登録失敗: \(error.localizedDescription)") }
  }

  /// フォアグラウンド中でも banner + sound を出す (既定だと前面時は抑制される)。
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void,
  ) {
    completionHandler([.banner, .sound])
  }

  /// 通知タップ → coordinator に「前面化したから即接続し直して」と知らせる。
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void,
  ) {
    NotificationCenter.default.post(name: .vigiliPushTapped, object: nil)
    completionHandler()
  }
}

extension Notification.Name {
  /// APNs 通知タップで前面化したときに coordinator が即再接続するためのトリガ。
  static let vigiliPushTapped = Notification.Name("vigili.push.tapped")
}
