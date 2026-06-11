import Foundation
import Combine
import Darwin  // POSIX kill(2), SIGKILL

/// daemon の子プロセスを管理する。
///
/// 起動順序:
/// 1. daemon socket が既に alive → 外部 daemon に接続中として扱う (子プロセス不起動)
/// 2. socket dead → 子プロセスとして daemon を起動し、以後 stdout/stderr を監視
///
/// 外部 daemon モードでは 5 秒ごとに socket を ping し、
/// dead になったら子プロセスモードに切り替える。
@MainActor
final class DaemonController: ObservableObject {
  enum Status: Equatable {
    case stopped
    case starting
    case running(pid: Int32)
    case crashed(exitCode: Int32, willRetryAt: Date?)
    /// policy.yaml のスキーマ違反で起動失敗 (exit 2)。自動リトライしない。
    case policyError(message: String)
  }

  @Published private(set) var status: Status = .stopped

  let logBuffer = DaemonLogBuffer(capacity: 1000)

  private var process: Process?
  private var stdoutPipe: Pipe?
  private var stderrPipe: Pipe?

  private var consecutiveFailures = 0
  private var retryWorkItem: DispatchWorkItem?
  /// 外部 daemon の死活監視タイマー。
  private var externalPingTimer: Timer?

  private var nodeBinary: URL {
    if let override = UserDefaults.standard.string(forKey: "sentinel.nodeBinary") {
      return URL(fileURLWithPath: override)
    }
    return URL(fileURLWithPath: "/opt/homebrew/bin/node")
  }

  private var daemonCliJs: URL {
    if let override = UserDefaults.standard.string(forKey: "sentinel.daemonCliJs") {
      return URL(fileURLWithPath: override)
    }
    let home = FileManager.default.homeDirectoryForCurrentUser
    return home
      .appendingPathComponent("Dropbox (個人)/sentinel/packages/daemon/dist/cli.js")
  }

  private var logFileURL: URL {
    let home = FileManager.default.homeDirectoryForCurrentUser
    return home.appendingPathComponent(".vigili/daemon.log")
  }

  /// daemon の Unix domain socket パス。
  private static func socketPath() -> String {
    if let env = ProcessInfo.processInfo.environment["VIGILI_HOME"]
        ?? ProcessInfo.processInfo.environment["SENTINEL_HOME"] {
      return "\(env)/daemon.sock"
    }
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    let vigili = "\(home)/.vigili/daemon.sock"
    let sentinel = "\(home)/.sentinel/daemon.sock"
    if FileManager.default.fileExists(atPath: "\(home)/.vigili") { return vigili }
    if FileManager.default.fileExists(atPath: "\(home)/.sentinel") { return sentinel }
    return vigili
  }

  // MARK: - public API

  func start() {
    guard process == nil, externalPingTimer == nil else { return }

    let sockPath = Self.socketPath()
    status = .starting

    // 先に外部 daemon が生きているか確認する
    Task { @MainActor [weak self] in
      guard let self else { return }
      let alive = await Self.pingUnixSocket(sockPath)
      if alive {
        self.logBuffer.append(line: "[Vigili.app] external daemon detected on \(sockPath)")
        self.status = .running(pid: 0)
        self.startExternalPing(sockPath: sockPath)
      } else {
        self.launchChildProcess()
      }
    }
  }

  func stop(timeout: TimeInterval = 3.0) {
    retryWorkItem?.cancel()
    retryWorkItem = nil
    stopExternalPing()
    guard let p = process, p.isRunning else {
      process = nil
      status = .stopped
      return
    }
    p.terminationHandler = nil

    p.terminate()
    let deadline = Date().addingTimeInterval(timeout)
    while p.isRunning && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.05)
    }
    if p.isRunning {
      kill(p.processIdentifier, SIGKILL)
      logBuffer.append(line: "[Vigili.app] daemon did not exit in \(timeout)s, sent SIGKILL")
    } else {
      logBuffer.append(line: "[Vigili.app] daemon stopped cleanly")
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

  // MARK: - external daemon ping

  private func startExternalPing(sockPath: String) {
    stopExternalPing()
    let t = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
      Task { @MainActor [weak self] in
        guard let self, self.process == nil else { return }
        let alive = await Self.pingUnixSocket(sockPath)
        if !alive {
          self.logBuffer.append(line: "[Vigili.app] external daemon gone, will launch own")
          self.stopExternalPing()
          self.status = .stopped
          self.scheduleRetry()
        }
      }
    }
    RunLoop.main.add(t, forMode: .common)
    externalPingTimer = t
  }

  private func stopExternalPing() {
    externalPingTimer?.invalidate()
    externalPingTimer = nil
  }

  // MARK: - child process launch

  private func launchChildProcess() {
    guard FileManager.default.fileExists(atPath: nodeBinary.path) else {
      logBuffer.append(line: "[Vigili.app] node binary not found at \(nodeBinary.path)")
      status = .stopped
      return
    }
    guard FileManager.default.fileExists(atPath: daemonCliJs.path) else {
      logBuffer.append(line: "[Vigili.app] daemon cli.js not found at \(daemonCliJs.path)")
      status = .stopped
      return
    }

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
      logBuffer.append(line: "[Vigili.app] daemon started, pid=\(p.processIdentifier)")
    } catch {
      logBuffer.append(line: "[Vigili.app] daemon start failed: \(error.localizedDescription)")
      status = .stopped
      scheduleRetry()
    }
  }

  // MARK: - private

  private func environmentForChild() -> [String: String] {
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
    env["HOME"] = FileManager.default.homeDirectoryForCurrentUser.path
    return env
  }

  private func attachLogReader(_ handle: FileHandle, label: String) {
    let url = logFileURL
    handle.readabilityHandler = { [weak self] fh in
      let data = fh.availableData
      guard !data.isEmpty else {
        fh.readabilityHandler = nil
        return
      }
      Self.appendToLogFile(data: data, url: url)
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
      NSLog("[Vigili.app] log append failed: \(error)")
    }
  }

  private func handleTermination(exitCode: Int32) {
    process = nil
    stdoutPipe = nil
    stderrPipe = nil
    logBuffer.append(line: "[Vigili.app] daemon exited code=\(exitCode)")

    // 外部 daemon が生きていれば子プロセス起動は不要
    let sockPath = Self.socketPath()
    Task { @MainActor [weak self] in
      guard let self else { return }
      let alive = await Self.pingUnixSocket(sockPath)
      if alive {
        self.logBuffer.append(line: "[Vigili.app] external daemon is alive, switching to external mode")
        self.status = .running(pid: 0)
        self.startExternalPing(sockPath: sockPath)
        return
      }
      if exitCode == 0 {
        self.status = .stopped
      } else if exitCode == 2 {
        // policy.yaml スキーマ違反 — 自動リトライしない (ループしても直らない)。
        // logBuffer の最新行からエラーメッセージを拾って UI に表示する。
        let msg = self.logBuffer.lastLines(10)
          .first { $0.contains("ポリシーロード失敗") || $0.contains("スキーマ違反") }
          ?? "policy.yaml に問題があります。~/.vigili/policy.yaml を確認してください。"
        self.status = .policyError(message: msg)
        self.logBuffer.append(line: "[Vigili.app] policy error — auto-retry suppressed")
        return
      } else {
        self.consecutiveFailures += 1
        self.status = .crashed(exitCode: exitCode, willRetryAt: Date().addingTimeInterval(self.retryDelay()))
      }
      self.scheduleRetry()
    }
  }

  private func retryDelay() -> TimeInterval {
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
    logBuffer.append(line: "[Vigili.app] will retry daemon in \(Int(delay))s")
  }

  /// Unix domain socket に接続できるか非同期で確認する。
  private static func pingUnixSocket(_ path: String) async -> Bool {
    await withCheckedContinuation { continuation in
      guard FileManager.default.fileExists(atPath: path) else {
        continuation.resume(returning: false)
        return
      }
      let sock = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
      guard sock >= 0 else { continuation.resume(returning: false); return }

      var addr = sockaddr_un()
      addr.sun_family = sa_family_t(AF_UNIX)
      // sun_path は固定長 char[104]。path を安全にコピーする。
      let pathBytes = Array(path.utf8)
      let maxLen = MemoryLayout.size(ofValue: addr.sun_path) - 1
      withUnsafeMutableBytes(of: &addr.sun_path) { buf in
        let count = min(pathBytes.count, maxLen)
        for i in 0..<count { buf[i] = pathBytes[i] }
        buf[count] = 0
      }
      let len = socklen_t(MemoryLayout<sockaddr_un>.stride)

      let result = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
          Darwin.connect(sock, sa, len)
        }
      }
      Darwin.close(sock)
      continuation.resume(returning: result == 0)
    }
  }
}
