import AppKit

/// アプリのライフサイクルフック。
///
/// 主な仕事:
/// - quit 時に daemon を確実に SIGTERM (子プロセスの孤児化防止)
/// - 初回起動時に旧 launchd plist を bootout (Phase 11 → Phase 12 移行)
///
/// SwiftUI 単独だとアプリ終了時の cleanup タイミングが曖昧なので、
/// AppKit の `applicationWillTerminate` をフックする。
final class AppDelegate: NSObject, NSApplicationDelegate {
  /// `SentinelApp` の `AppCoordinator` と同じインスタンスを参照したいので
  /// `applicationDidFinishLaunching` の時点で注入する。
  /// (現状は AppCoordinator がシングルトン的に動くので直接アクセスで足りる)
  static let shared = AppDelegate()

  func applicationDidFinishLaunching(_ notification: Notification) {
    // bundle 内の .ttf を CoreText に登録 (Bricolage Grotesque, JetBrains Mono)
    FontRegistration.registerBundledFonts()

    // 旧 launchd plist を booting した状態で起動されると 7878 ポート競合になるため、
    // 起動時に一度だけ migration を試みる。
    LaunchdMigrator.boototIfLoaded()

    // 重複起動防止: 既に Sentinel.app が走っていたら自分は静かに終了する。
    if isAnotherInstanceRunning() {
      NSLog("[Sentinel] another instance already running, quitting.")
      NSApp.terminate(nil)
    }
  }

  func applicationWillTerminate(_ notification: Notification) {
    // 同期的に daemon を SIGTERM し、最大 3 秒だけ待つ。
    AppCoordinator.shared?.daemonController.stop(timeout: 3.0)
  }

  // 重複起動の検知。同じバンドル ID で別 PID が存在する場合 true。
  private func isAnotherInstanceRunning() -> Bool {
    let bundleId = Bundle.main.bundleIdentifier ?? "io.sentinel.app"
    let me = ProcessInfo.processInfo.processIdentifier
    let others = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
      .filter { $0.processIdentifier != me }
    return !others.isEmpty
  }
}
