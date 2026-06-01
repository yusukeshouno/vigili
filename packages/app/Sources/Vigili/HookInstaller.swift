import Foundation

/// `~/.claude/settings.json` に Vigili gate の PreToolUse hook を冪等・非破壊で追加する。
///
/// 既存の `permissions` や他の hook を壊さない。既に `vigili-gate` / `sentinel-gate` を含む
/// command があれば「導入済み」として何もしない。書き込みは atomic + 初回バックアップ。
enum HookInstaller {
  static let matcher = "Bash|Edit|Write|WebFetch"

  struct Result {
    let installed: Bool
    let alreadyPresent: Bool
    let settingsPath: String
    let gateCommand: String
  }

  enum HookError: Error, LocalizedError {
    case unreadable(String)
    case malformedSettings(String)
    case unwritable(String)
    case gateNotFound

    var errorDescription: String? {
      switch self {
      case .unreadable(let m): return "settings.json を読めません: \(m)"
      case .malformedSettings(let m): return "settings.json の形式が不正です: \(m)"
      case .unwritable(let m): return "settings.json を書けません: \(m)"
      case .gateNotFound: return "vigili-gate が見つかりません (pnpm build 後に再試行してください)"
      }
    }
  }

  private static var settingsURL: URL {
    FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/settings.json")
  }

  /// gate コマンドを解決する: PATH 上の `vigili-gate`/`sentinel-gate` → repo の wrapper script。
  static func resolveGateCommand() -> String? {
    if let override = UserDefaults.standard.string(forKey: "sentinel.gateCommand"),
      !override.isEmpty
    {
      return override
    }
    let fm = FileManager.default
    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
      for name in ["vigili-gate", "sentinel-gate"] where fm.isExecutableFile(atPath: "\(dir)/\(name)") {
        return name
      }
    }
    // dev レイアウト: repo の wrapper script の絶対パス。
    let wrapper = fm.homeDirectoryForCurrentUser
      .appendingPathComponent("Dropbox (個人)/sentinel/scripts/vigili-gate")
    return fm.isExecutableFile(atPath: wrapper.path) ? wrapper.path : nil
  }

  static func isInstalled() -> Bool {
    // try? は throwing + Optional 返却を [String:Any]? にフラット化する。
    // 読めない/不在なら nil → 未導入扱い。
    guard let root = try? readSettings() else { return false }
    return hasVigiliHook(in: root)
  }

  @discardableResult
  static func installIfNeeded() throws -> Result {
    guard let gateCmd = resolveGateCommand() else { throw HookError.gateNotFound }
    let fm = FileManager.default
    try? fm.createDirectory(
      at: settingsURL.deletingLastPathComponent(), withIntermediateDirectories: true,
    )

    var root = (try readSettings()) ?? [:]
    if hasVigiliHook(in: root) {
      return Result(
        installed: false, alreadyPresent: true,
        settingsPath: settingsURL.path, gateCommand: gateCmd,
      )
    }

    // 初回書き込み前にバックアップ (既存設定を保護)。
    if fm.fileExists(atPath: settingsURL.path) {
      let bak = settingsURL.appendingPathExtension("vigili.bak")
      try? fm.removeItem(at: bak)
      try? fm.copyItem(at: settingsURL, to: bak)
    }

    var hooks = (root["hooks"] as? [String: Any]) ?? [:]
    var preToolUse = (hooks["PreToolUse"] as? [[String: Any]]) ?? []
    preToolUse.append([
      "matcher": matcher,
      "hooks": [["type": "command", "command": "\(gateCmd) --session $CLAUDE_SESSION_ID"]],
    ])
    hooks["PreToolUse"] = preToolUse
    root["hooks"] = hooks

    do {
      let data = try JSONSerialization.data(
        withJSONObject: root, options: [.prettyPrinted, .sortedKeys],
      )
      try data.write(to: settingsURL, options: .atomic)
    } catch {
      throw HookError.unwritable(error.localizedDescription)
    }
    return Result(
      installed: true, alreadyPresent: false,
      settingsPath: settingsURL.path, gateCommand: gateCmd,
    )
  }

  // MARK: - helpers

  /// settings.json を読む。不在なら nil、空なら空 dict、object でなければ throw。
  private static func readSettings() throws -> [String: Any]? {
    let fm = FileManager.default
    guard fm.fileExists(atPath: settingsURL.path) else { return nil }
    let data: Data
    do {
      data = try Data(contentsOf: settingsURL)
    } catch {
      throw HookError.unreadable(error.localizedDescription)
    }
    if data.isEmpty { return [:] }
    let obj: Any
    do {
      obj = try JSONSerialization.jsonObject(with: data)
    } catch {
      throw HookError.malformedSettings(error.localizedDescription)
    }
    guard let dict = obj as? [String: Any] else {
      throw HookError.malformedSettings("root is not a JSON object")
    }
    return dict
  }

  private static func hasVigiliHook(in root: [String: Any]) -> Bool {
    guard
      let hooks = root["hooks"] as? [String: Any],
      let preToolUse = hooks["PreToolUse"] as? [[String: Any]]
    else { return false }
    for group in preToolUse {
      guard let inner = group["hooks"] as? [[String: Any]] else { continue }
      for h in inner {
        if let cmd = h["command"] as? String,
          cmd.contains("vigili-gate") || cmd.contains("sentinel-gate")
        {
          return true
        }
      }
    }
    return false
  }
}
