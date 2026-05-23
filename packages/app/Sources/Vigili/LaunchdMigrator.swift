import Foundation

/// Phase 11 で導入した `io.sentinel.daemon` launchd job を、Phase 12 (アプリ管理) に移行する。
///
/// やること:
/// - `launchctl list io.sentinel.daemon` で job が登録されているか確認
/// - 登録されていれば `launchctl bootout gui/<uid> ~/Library/LaunchAgents/io.sentinel.daemon.plist`
///   で外す (= launchd は二度と起動しなくなる)
/// - plist ファイル自体は残す。ユーザがアプリをアンインストールしたら手動で
///   `launchctl bootstrap` し直せば Phase 11 に戻れる。
///
/// PWA (`io.sentinel.pwa`) は Phase 12-D で同じ手順で扱う予定。今は触らない。
enum LaunchdMigrator {
  static func boototIfLoaded() {
    let label = "io.sentinel.daemon"
    guard isLoaded(label: label) else {
      NSLog("[Sentinel.app] launchd job \(label) not loaded, skipping migration")
      return
    }
    let plistPath = ("~/Library/LaunchAgents/\(label).plist" as NSString)
      .expandingTildeInPath
    guard FileManager.default.fileExists(atPath: plistPath) else {
      NSLog("[Sentinel.app] plist not found at \(plistPath), skipping bootout")
      return
    }
    let uid = getuid()
    let result = runLaunchctl(args: ["bootout", "gui/\(uid)", plistPath])
    NSLog("[Sentinel.app] bootout \(label): exit=\(result.exitCode) out=\(result.stdout)")
  }

  /// `launchctl list <label>` が 0 を返すか。
  private static func isLoaded(label: String) -> Bool {
    let r = runLaunchctl(args: ["list", label])
    return r.exitCode == 0
  }

  @discardableResult
  private static func runLaunchctl(args: [String]) -> (exitCode: Int32, stdout: String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    p.arguments = args
    let out = Pipe()
    p.standardOutput = out
    p.standardError = out
    do {
      try p.run()
      p.waitUntilExit()
      let data = out.fileHandleForReading.readDataToEndOfFile()
      let s = String(data: data, encoding: .utf8) ?? ""
      return (p.terminationStatus, s)
    } catch {
      NSLog("[Sentinel.app] launchctl run failed: \(error)")
      return (-1, "")
    }
  }
}
