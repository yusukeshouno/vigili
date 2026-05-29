import SwiftUI

/// PWA の `ApprovalCard.tsx` と同じ構造のカード。
///
/// レイアウト:
///   header   18/22/12 padding  : avatar + tag + session meta + tool chip
///   summary  0/22/12 padding   : "Run shell command" 等の 18pt 説明文
///   body     0/22/18 padding   : code block (#1F1E1D)
///   footer   10/22 padding     : top border + folder icon + cwd
///
/// Allow / Deny ボタンはカード内ではなく popover の footer 側に配置する
/// (PWA も card 自体は決定 UI を持たない設計)。
struct ApprovalCard: View {
  let request: ApprovalRequest

  var body: some View {
    let risk = RiskAssessment.evaluate(request)
    return VStack(alignment: .leading, spacing: 0) {
      // 危険/要注意は最初に目に入るよう、アバターアイコンより上に置く。
      if risk.isFlagged { riskBanner(risk) }
      header(topPadding: risk.isFlagged ? 12 : 14)
      summary
      bodyBlock
      footer
    }
    .background(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .fill(Theme.bgRise)
    )
    // 危険操作は背景にもごく薄いティントを敷いて目立たせる
    .background(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .fill(risk.level == .danger ? risk.tint : .clear)
    )
    // risk バナーをカード上端いっぱい (フルブリード) に敷くため、コンテンツごと
    // カード形状でクリップする。これで帯の上 2 角だけがカードの丸みに揃い、
    // 下側はカード幅いっぱいの直線で切れる。
    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 16, style: .continuous)
        .stroke(
          risk.isFlagged ? risk.color : Theme.borderStrong,
          lineWidth: risk.isFlagged ? 1.5 : 1
        )
    )
  }

  // MARK: - sections

  /// 危険 / 要注意 を 1 行で喚起するバナー (カード最上部のフルブリード帯)。
  ///
  /// 角丸は付けず、左右はカード端いっぱいまで地を伸ばす。上 2 角の丸みは
  /// カード全体の `clipShape` が担い、下端はカード幅いっぱいの直線で切れる。
  private func riskBanner(_ risk: RiskAssessment) -> some View {
    HStack(spacing: 6) {
      Image(systemName: "exclamationmark.triangle.fill")
        .font(.system(size: 9, weight: .bold))
      Text(risk.label)
        .font(.mono(8, weight: .bold))
        .tracking(0.14 * 8)
      Text(risk.reason ?? "")
        .font(.mono(9))
        .lineLimit(1)
        .truncationMode(.tail)
    }
    .foregroundStyle(risk.color)
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 18)
    .padding(.vertical, 6)
    .background(risk.tint)
  }

  private func header(topPadding: CGFloat) -> some View {
    HStack(spacing: 12) {
      // Avatar: tag のハッシュから色を取り、tag の頭文字を入れる
      ZStack {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
          .fill(AgentColor.color(for: request.sessionTag))
        Text(String((request.sessionTag?.first ?? "?").uppercased()))
          .font(.mono(10, weight: .semibold))
          .foregroundStyle(.white)
      }
      .frame(width: 22, height: 22)

      VStack(alignment: .leading, spacing: 2) {
        Text(request.sessionTag ?? "untagged")
          .font(.mono(10))
          .foregroundStyle(Theme.fg)
          .lineLimit(1)
          .truncationMode(.tail)
        Text(metaLine)
          .font(.mono(8))
          .tracking(0.14 * 8)
          .textCase(.uppercase)
          .foregroundStyle(Theme.fgDim)
          .lineLimit(1)
          .truncationMode(.tail)
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      // Tool chip
      HStack(spacing: 4) {
        Image(systemName: toolIcon)
          .font(.system(size: 8))
        Text(request.toolName.uppercased())
          .font(.mono(8, weight: .semibold))
          .tracking(0.12 * 8)
      }
      .foregroundStyle(Theme.fgMid)
      .padding(.horizontal, 6)
      .padding(.vertical, 3)
      .background(
        Capsule().stroke(Theme.border, lineWidth: 1)
      )
    }
    .padding(.top, topPadding)
    .padding(.horizontal, 18)
    .padding(.bottom, 8)
  }

  private var summary: some View {
    Text(toolSummary)
      .font(.display(13, weight: .medium))
      .tracking(-0.01 * 13)
      .foregroundStyle(Theme.fg)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 18)
      .padding(.bottom, 8)
  }

  private var bodyBlock: some View {
    HStack(alignment: .top, spacing: 0) {
      Text(bodyText)
        .font(.mono(10))
        .foregroundStyle(Theme.fg.opacity(0.88))
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }
    .background(
      RoundedRectangle(cornerRadius: 9, style: .continuous)
        .fill(Theme.bgCode)
    )
    .overlay(
      RoundedRectangle(cornerRadius: 9, style: .continuous)
        .stroke(Theme.border, lineWidth: 1)
    )
    .padding(.horizontal, 18)
    .padding(.bottom, 14)
  }

  private var footer: some View {
    HStack(spacing: 6) {
      Image(systemName: "folder")
        .font(.system(size: 8))
        .foregroundStyle(Theme.fgDim)
      Text(request.cwd)
        .font(.mono(8))
        .tracking(0.08 * 8)
        .foregroundStyle(Theme.fgDim)
        .lineLimit(1)
        .truncationMode(.head)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 18)
    .padding(.vertical, 8)
    .overlay(alignment: .top) {
      Rectangle().fill(Theme.border).frame(height: 1)
    }
  }

  // MARK: - body content

  private var bodyText: String {
    switch request.toolName {
    case "Bash":
      return "$ " + ((request.toolInput["command"] as? String) ?? "(no command)")
    case "Edit", "Write":
      return (request.toolInput["file_path"] as? String)
        ?? (request.toolInput["path"] as? String)
        ?? "(no path)"
    case "WebFetch":
      return (request.toolInput["url"] as? String) ?? "(no url)"
    default:
      if let json = try? JSONSerialization.data(withJSONObject: request.toolInput, options: [.prettyPrinted]),
         let s = String(data: json, encoding: .utf8) {
        return s
      }
      return "{}"
    }
  }

  private var toolSummary: String {
    switch request.toolName {
    case "Bash": return "Run shell command"
    case "Edit": return "Apply diff to source file"
    case "Write": return "Create or replace file"
    case "WebFetch": return "Fetch remote resource"
    default: return "Tool call: \(request.toolName)"
    }
  }

  private var toolIcon: String {
    switch request.toolName {
    case "Bash": return "terminal"
    case "Edit", "Write": return "pencil"
    case "WebFetch": return "globe"
    default: return "wrench.and.screwdriver"
    }
  }

  private var metaLine: String {
    let sid = request.sessionId.prefix(12)
    let age = max(0, Int(-request.createdAt.timeIntervalSinceNow))
    return "session · \(sid) · \(age)s ago"
  }
}
