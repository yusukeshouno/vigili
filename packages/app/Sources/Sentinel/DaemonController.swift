import Foundation
import Combine
import Darwin  // POSIX kill(2), SIGKILL

/// daemon の子プロセスを管理する。
///
/// 責務:
/// - daemon を `node .../daemon/dist/cli.js start` で起動
/// - stdout/stderr を内部リングバッファに溜め、ファイルにも追記
/// - 異常終了 (exit != 0) を検知して exponential backoff で再起動
/// - アプリ quit 時に SIGTERM を送信し、3 秒以内に落ちなければ SIGKILL
///
/// 設計上の考慮:
/// - `Process` は非 sandbox 下なら任意の executable を起動できる
/// - 終了通知は `terminationHandler` で取れる
/// - stdout/stderr は `Pipe` 経由で `FileHandle.readabilityHandler` を貼って非同期に読む
@MainActor
final class DaemonController: ObservableObject {
  enum Status: Equatable {
    case stopped
    case starting
    case running(pid: Int32)
    case crashed(exitCode: Int32, willRetryAt: Date?)
  }

  @Published private(set) var status: Status = .stopped

  /// 直近 1000 行のログをメモリに保持。SwiftUI から逆順表示などに使う。
  let logBuffer = DaemonLogBuffer(capacity: 1000)

  private var process: Process?
  private var stdoutPipe: Pipe?
  private var stderrPipe: Pipe?

  /// 再起動の指数バックオフ用カウンタ。
  /// `start()` 成功 → 0 にリセット、クラッシュごとに +1。
  private var consecutiveFailures = 0
  private var retryWorkItem: DispatchWorkItem?

  /// node 実行ファイル。Homebrew Apple Silicon を想定するが、UserDefaults で上書き可。
  private var nodeBinary: URL {
    if let override = UserDefaults.standard.string(forKey: "sentinel.nodeBinary") {
      return URL(fileURLWithPath: override)
    }
    return URL(fileURLWithPath: "/opt/homebrew/bin/node")
  }

  /// daemon の cli.js。
  /// デフォルトは現リポジトリの dist。12-F でアプリバンドル内に同梱に切替。
  private var daemonCliJs: URL {
    if let override = UserDefaults.standard.string(forKey: "sentinel.daemonCliJs") {
      return URL(fileURLWithPath: override)
    }
    let home = FileManager.default.homeDirectoryForCurrentUser
    return home
      .appendingPathComponent("Dropbox (個人)/sentinel/packages/daemon/dist/cli.js")
  }

  /// daemon ログを永続化するファイル (~/.sentinel/daemon.log)。
  private var logFileURL: URL {
    let home = FileManager.default.homeDirectoryForCurrentUser
    return home.appendingPathComponent(".sentinel/daemon.log")
  }

  // MARK: - public API

  func start() {
    guard process == nil else { return }
    guard FileManager.default.fileExists(atPath: nodeBinary.path) else {
      logBuffer.append(line: "[Sentinel.app] node binary not found at \(nodeBinary.path)")
      status = .stopped
      return
    }
    guard FileManager.default.fileExists(atPath: daemonCliJs.path) else {
      logBuffer.append(line: "[Sentinel.app] daemon cli.js not found at \(daemonCliJs.path)")
      status = .stopped
      return
    }
    status = .starting

    let p = Process()
    p.executableURL = nodeBinary
    p.arguments = [daemonCliJs.path, "start"]
    p.environment = environmentForChild()
    p.currentDirectoryURL = FileManager.default.homeDirectoryForCurrentUser

    let outPipe = Pipe()
    let errPipe = Pipe()
    p.standardOutput = outPipe
    p.standardError = errPipe

    attachLogReader(outPipe.fileHandleForReading, label: "stdout")
    attachLogReader(errPipe.fileHandleForReading, label: "stderr")

    p.terminationHandler = { [weak self] terminated in
      let code = terminated.terminationStatus
      // termination handler は別スレッドで呼ばれるため main に戻す
      Task { @MainActor [weak self] in
        self?.handleTermination(exitCode: code)
      }
    }

    do {
      try p.run()
      process = p
      stdoutPipe = outPipe
      stderrPipe = errPipe
      consecutiveFailures = 0
      status = .running(pid: p.processIdentifier)
      logBuffer.append(line: "[Sentinel.app] daemon started, pid=\(p.processIdentifier)")
    } catch {
      logBuffer.append(line: "[Sentinel.app] daemon start failed: \(error.localizedDescription)")
      status = .stopped
      scheduleRetry()
    }
  }

  /// 同期的に SIGTERM → 待機 → 必要なら SIGKILL。
  /// `timeout` は SIGTERM 後に waitUntilExit を待つ秒数。
  /// アプリ終了時の `applicationWillTerminate` から呼ばれる。
  func stop(timeout: TimeInterval = 3.0) {
    retryWorkItem?.cancel()
    retryWorkItem = nil
    guard let p = process, p.isRunning else {
      process = nil
      status = .stopped
      return
    }
    p.terminationHandler = nil  // 自動 retry を無効化

    p.terminate()
    let deadline = Date().addingTimeInterval(timeout)
    while p.isRunning && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.05)
    }
    if p.isRunning {
      // 強制終了 (SIGKILL は Process API では直接無いので kill(2) を呼ぶ)
      kill(p.processIdentifier, SIGKILL)
      logBuffer.append(line: "[Sentinel.app] daemon did not exit in \(timeout)s, sent SIGKILL")
    } else {
      logBuffer.append(line: "[Sentinel.app] daemon stopped cleanly")
    }
    process = nil
    stdoutPipe = nil
    stderrPipe = nil
    status = .stopped
  }

  func restart() {
    stop()
    start()
  }

  // MARK: - private

  private func environmentForChild() -> [String: String] {
    var env = ProcessInfo.processInfo.environment
    // PATH に homebrew を確実に入れる。launchd と同様、最小構成。
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    env["HOME"] = FileManager.default.homeDirectoryForCurrentUser.path
    return env
  }

  private func attachLogReader(_ handle: FileHandle, label: String) {
    // readabilityHandler は background thread で走るが、self のプロパティは
    // すべて @MainActor 隔離されている。MainActor に戻すコストを避けるため、
    // 必要な URL を事前にキャプチャして静的な nonisolated 関数に流す。
    let url = logFileURL
    handle.readabilityHandler = { [weak self] fh in
      let data = fh.availableData
      guard !data.isEmpty else {
        fh.readabilityHandler = nil
        return
      }
      // ファイル追記は nonisolated なのでこのまま OK
      Self.appendToLogFile(data: data, url: url)

      // メモリ上のリングバッファは @MainActor。MainActor へ戻して書く。
      guard let s = String(data: data, encoding: .utf8) else { return }
      let lines = s.split(separator: "\n", omittingEmptySubsequences: false)
        .map(String.init)
        .filter { !$0.isEmpty }
      Task { @MainActor [weak self] in
        for line in lines {
          self?.logBuffer.append(line: line)
        }
      }
    }
  }

  /// ログファイル追記は actor 隔離不要。pure file I/O。
  /// 並行書き込みの可能性はあるが O_APPEND セマンティクスで安全
  /// (FileHandle.write は seekToEnd + write を atomic に行うわけではない点に注意
  ///  ── 12-A 時点では stdout/stderr 二経路の同時 flush は稀なので許容)。
  private nonisolated static func appendToLogFile(data: Data, url: URL) {
    do {
      try FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      if !FileManager.default.fileExists(atPath: url.path) {
        FileManager.default.createFile(atPath: url.path, contents: nil)
      }
      let fh = try FileHandle(forWritingTo: url)
      try fh.seekToEnd()
      try fh.write(contentsOf: data)
      try fh.close()
    } catch {
      NSLog("[Sentinel.app] log append failed: \(error)")
    }
  }

  private func handleTermination(exitCode: Int32) {
    process = nil
    stdoutPipe = nil
    stderrPipe = nil
    logBuffer.append(line: "[Sentinel.app] daemon exited code=\(exitCode)")
    if exitCode == 0 {
      // 正常終了。stop() 経由で来たケースは status が .stopped 済み。
      // それ以外で 0 終了することは daemon 設計上ないので一応 retry もする。
      status = .stopped
      scheduleRetry()
    } else {
      consecutiveFailures += 1
      status = .crashed(exitCode: exitCode, willRetryAt: Date().addingTimeInterval(retryDelay()))
      scheduleRetry()
    }
  }

  private func retryDelay() -> TimeInterval {
    // exponential backoff: 1, 2, 4, 8, 16, 30 (cap)
    let base = pow(2.0, Double(min(consecutiveFailures, 5)))
    return min(base, 30.0)
  }

  private func scheduleRetry() {
    let delay = retryDelay()
    let work = DispatchWorkItem { [weak self] in
      Task { @MainActor [weak self] in
        self?.start()
      }
    }
    retryWorkItem = work
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    logBuffer.append(line: "[Sentinel.app] will retry daemon in \(Int(delay))s")
  }
}
