import Foundation

/// 開発時のデバッグログ。両プラットフォーム共通。
///
/// - macOS: `~/.sentinel/app.log` に追記 (Mac daemon と同じ場所)
/// - iOS:   `Documents/app.log` に追記 (sandbox 内、Xcode から取り出せる)
///
/// stderr にも書くので Xcode 実行時はコンソールにも出る。
func appLog(_ msg: String) {
  let ts = ISO8601DateFormatter().string(from: Date())
  let line = "\(ts) \(msg)\n"

  let url: URL
  #if os(macOS)
  let dir = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent(".sentinel")
  url = dir.appendingPathComponent("app.log")
  #else
  let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  url = dir.appendingPathComponent("app.log")
  #endif

  do {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    if !FileManager.default.fileExists(atPath: url.path) {
      FileManager.default.createFile(atPath: url.path, contents: Data(line.utf8))
    } else {
      let h = try FileHandle(forWritingTo: url)
      try h.seekToEnd()
      try h.write(contentsOf: Data(line.utf8))
      try h.close()
    }
  } catch {
    NSLog("[Sentinel] appLog failed: \(error.localizedDescription)")
  }
  fputs("[Sentinel] \(msg)\n", stderr)
}
