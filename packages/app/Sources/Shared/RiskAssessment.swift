import SwiftUI

/// 承認リクエストのクライアント側リスク評価 (表示用ヒューリスティック)。
///
/// 判定の正は daemon 側ポリシー (`policy/invariants.ts` など) であり、これは
/// あくまで **人間に注意を喚起する** ための視覚ヒント。CLAUDE.md の
/// 「危険な操作は必ず人間に問う」カテゴリ (rm -rf / force push / .env 書換 /
/// 外部課金 / 本番 DB) と「サーバーに書き込む・設定を変える」をミラーする。
///
/// 過剰検知は alert fatigue を生むため、本当に破壊的・取り返しのつかない・
/// 秘密情報や本番に触れる操作だけを `.danger` とし、サーバーへの書き込みや
/// 設定変更など「要注意」レベルを `.caution`、それ以外を `.normal` とする。
enum RiskLevel {
  case normal
  case caution
  case danger
}

struct RiskAssessment {
  let level: RiskLevel
  /// 日本語の短い理由 (カードに 1 行で出す)。`.normal` の時は nil。
  let reason: String?

  static let normal = RiskAssessment(level: .normal, reason: nil)

  var isFlagged: Bool { level != .normal }

  /// この操作を「今後は自動で承認」(ルール昇格) してよいか。
  /// `.danger` を常時 allow 化すると取り返しがつかないため自動承認を禁じる
  /// (CLAUDE.md「危険な操作は必ず人間に問う」)。Mac/iOS の actionsBar で共用。
  var allowsAutoApprove: Bool { level != .danger }

  var color: Color {
    switch level {
    case .danger: return Theme.red
    case .caution: return Theme.amber
    case .normal: return Theme.borderStrong
    }
  }

  /// カード背景に敷くごく薄いティント。
  var tint: Color { color.opacity(0.14) }

  /// バッジ左端の短いラベル。
  var label: String {
    switch level {
    case .danger: return "危険"
    case .caution: return "要注意"
    case .normal: return ""
    }
  }

  // MARK: - 評価

  static func evaluate(_ req: ApprovalRequest) -> RiskAssessment {
    switch req.toolName {
    case "Bash":
      return evaluateBash((req.toolInput["command"] as? String) ?? "")
    case "Edit", "Write":
      let path = (req.toolInput["file_path"] as? String)
        ?? (req.toolInput["path"] as? String) ?? ""
      return evaluatePath(path, cwd: req.cwd)
    default:
      return .normal
    }
  }

  // MARK: - 内部

  private static func danger(_ r: String) -> RiskAssessment { .init(level: .danger, reason: r) }
  private static func caution(_ r: String) -> RiskAssessment { .init(level: .caution, reason: r) }

  /// ICU 正規表現 (大文字小文字無視) でのマッチ判定。
  private static func m(_ s: String, _ pattern: String) -> Bool {
    s.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
  }

  private static func evaluateBash(_ cmd: String) -> RiskAssessment {
    guard !cmd.isEmpty else { return .normal }

    // ---------- danger ----------
    let isRm = m(cmd, #"(^|[\s;&|])rm\s"#)
    let rmRecursiveForce = isRm && (
      m(cmd, #"-[a-z]*r[a-z]*f"#) || m(cmd, #"-[a-z]*f[a-z]*r"#)
        || (m(cmd, #"(^|\s)-r(\s|$)"#) && m(cmd, #"(^|\s)-f(\s|$)"#))
        || m(cmd, #"--recursive"#)
    )
    if rmRecursiveForce { return danger("ファイルを再帰的に削除") }

    if m(cmd, #"\bgit\s+push\b"#)
      && m(cmd, #"(--force\b|--force-with-lease\b|\s-f\b)"#) {
      return danger("強制プッシュ (履歴を上書き)")
    }
    if m(cmd, #"(^|[\s;&|])(sudo|doas)\s"#) { return danger("管理者権限で実行 (sudo)") }
    if m(cmd, #"(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b"#) {
      return danger("取得したスクリプトを直接実行")
    }
    // 実ブロックデバイス (/dev/sda, /dev/disk2, /dev/nvme0n1 …) への書き込みのみ危険。
    // /dev/null・/dev/stdout・/dev/stderr・/dev/tty 等の擬似デバイスは無害で
    // `2>/dev/null` のように極めて頻出するため、デバイス名を限定して誤検知を防ぐ。
    let blockDev = #"/dev/(disk|rdisk|sd|hd|nvme|mmcblk|vd|loop|md)"#
    if m(cmd, #"\bdd\b[^|\n]*\bof="# + blockDev)
      || m(cmd, #"\bmkfs"#)
      || m(cmd, #">\s*"# + blockDev) {
      return danger("ディスク/デバイスへ直接書き込み")
    }
    if m(cmd, #"\bchmod\b[^|\n]*(777|-R\b|--recursive)"#) { return danger("ファイル権限を広く変更") }
    if m(cmd, #"\b(drop\s+(table|database)|truncate\s+table|delete\s+from)\b"#) {
      return danger("DB を破壊的に変更")
    }
    if m(cmd, #"(^|[\s;&|])(shutdown|reboot|halt|poweroff)\b"#) { return danger("システムを停止/再起動") }
    if m(cmd, #"\b(scp|rsync)\b[^|\n]*\s[\w.@-]+:"#) { return danger("リモートサーバーへ書き込み") }
    if m(cmd, #"--prod(uction)?\b"#) || m(cmd, #"\bterraform\s+(apply|destroy)\b"#)
      || m(cmd, #"\bkubectl\b[^|\n]*\bdelete\b"#) {
      return danger("本番環境/インフラへ反映")
    }

    // ---------- caution ----------
    if m(cmd, #"\b(curl|wget|http|https|xh)\b"#)
      && m(cmd, #"(-X\s*(POST|PUT|PATCH|DELETE)|--request\s*(POST|PUT|PATCH|DELETE)|--data(-raw|-binary)?\b|(^|\s)-d\s)"#) {
      return caution("サーバーへ書き込み (POST 等)")
    }
    if m(cmd, #"\bgit\s+push\b"#) { return caution("リモートへ git push") }
    if m(cmd, #"\b(npm|pnpm|yarn)\s+publish\b"#) { return caution("パッケージを公開") }

    return .normal
  }

  private static func evaluatePath(_ path: String, cwd: String) -> RiskAssessment {
    guard !path.isEmpty else { return .normal }

    // ---------- danger: 秘密情報 / ポリシー ----------
    if m(path, #"(^|/)\.env(\.|$|/)"#)
      || m(path, #"\.(pem|key|p12|pfx)$"#)
      || m(path, #"(^|/)id_rsa"#)
      || m(path, #"/\.ssh/"#)
      || m(path, #"(^|/)\.npmrc$"#)
      || m(path, #"(^|/)(credentials?|secrets?)(\.|/|$)"#) {
      return danger("秘密情報ファイルを変更")
    }
    if m(path, #"(^|/)policy\.ya?ml$"#) { return danger("Vigili のポリシーを変更") }

    // ---------- caution: 設定ファイル / cwd 外 ----------
    if m(path, #"\.(ya?ml|toml|ini|conf)$"#)
      || m(path, #"\.config\.(js|ts|mjs|cjs|json)$"#)
      || m(path, #"(^|/)(Dockerfile|Makefile)$"#)
      || m(path, #"(^|/)\.(gitconfig|zshrc|bashrc|profile)$"#)
      || m(path, #"/\.config/"#)
      || m(path, #"\.plist$"#)
      || m(path, #"(^|/)(tsconfig|next\.config|vercel)\."#) {
      return caution("設定ファイルを変更")
    }
    if path.hasPrefix("/"), !cwd.isEmpty, !path.hasPrefix(cwd) {
      return caution("作業ディレクトリ外へ書き込み")
    }

    return .normal
  }
}
