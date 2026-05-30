import ActivityKit
import WidgetKit
import SwiftUI

/// Sentinel の Live Activity。
///
/// 4 つのプレゼンテーション形態:
///  1. Lock screen / Banner: ロック画面とバナー通知 (フル幅)
///  2. Dynamic Island (Expanded): 長押し時の展開表示
///  3. Dynamic Island (Compact): leading + trailing の 2 つの小さいラベル
///  4. Dynamic Island (Minimal): 1 アプリだけ縮退表示の最小アイコン
///
/// 表示のみ。タップ → アプリ起動。
/// インタラクティブな Allow/Deny ボタンは次フェーズ (App Intents) で追加。
struct VigiliLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: SentinelActivityAttributes.self) { context in
      LockScreenView(state: context.state)
        .activityBackgroundTint(Theme.bg)
        .activitySystemActionForegroundColor(Theme.accent)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          ExpandedLeading(state: context.state)
        }
        DynamicIslandExpandedRegion(.trailing) {
          ExpandedTrailing(state: context.state)
        }
        DynamicIslandExpandedRegion(.center) {
          EmptyView()
        }
        DynamicIslandExpandedRegion(.bottom) {
          ExpandedBottom(state: context.state)
        }
      } compactLeading: {
        CompactLeadingView()
      } compactTrailing: {
        Text("\(context.state.pendingCount)")
          .font(.system(size: 13, weight: .semibold, design: .monospaced))
          .foregroundStyle(activityAccent)
      } minimal: {
        Text("\(context.state.pendingCount)")
          .font(.system(size: 11, weight: .bold, design: .monospaced))
          .foregroundStyle(activityAccent)
      }
      .widgetURL(URL(string: "sentinel://r/\(context.state.top?.id ?? "")"))
      .keylineTint(activityAccent)
    }
  }
}

// MARK: - 共通色 (共有 Theme を参照)

private let activityAccent = Theme.accent
private let fgMid = Theme.fgMid

// MARK: - Lock screen / Banner

private struct LockScreenView: View {
  let state: SentinelActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 14) {
      // 左: フラワー + pending 数
      ZStack {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
          .fill(activityAccent.opacity(0.18))
        VStack(spacing: 2) {
          ActivityFlower(color: activityAccent, size: 18)
          Text("\(state.pendingCount)")
            .font(.system(size: 18, weight: .semibold, design: .monospaced))
            .foregroundStyle(activityAccent)
        }
      }
      .frame(width: 64, height: 64)

      // 中央: 一番上のリクエストの概要
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 6) {
          Text(state.top?.tool.uppercased() ?? "PENDING")
            .font(.system(size: 10, weight: .bold, design: .monospaced))
            .tracking(0.12 * 10)
            .foregroundStyle(fgMid)
          if let tag = state.top?.tag {
            Text("· \(tag)")
              .font(.system(size: 10, design: .monospaced))
              .foregroundStyle(fgMid)
              .lineLimit(1)
          }
        }
        Text(state.top?.preview ?? "awaiting decision")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(.white)
          .lineLimit(2)
          .multilineTextAlignment(.leading)
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      // 右: 経過秒
      VStack(alignment: .trailing, spacing: 2) {
        if let start = state.top?.createdAtMs {
          ElapsedText(startMs: start)
            .font(.system(size: 12, weight: .semibold, design: .monospaced))
            .foregroundStyle(activityAccent)
        }
        Text("OPEN →")
          .font(.system(size: 9, weight: .semibold, design: .monospaced))
          .tracking(0.12 * 9)
          .foregroundStyle(fgMid)
      }
    }
    .padding(14)
  }
}

// MARK: - Dynamic Island Expanded

private struct ExpandedLeading: View {
  let state: SentinelActivityAttributes.ContentState
  var body: some View {
    HStack(spacing: 8) {
      ActivityFlower(color: activityAccent, size: 18)
      VStack(alignment: .leading, spacing: 1) {
        Text("\(state.pendingCount) PENDING")
          .font(.system(size: 11, weight: .bold, design: .monospaced))
          .foregroundStyle(activityAccent)
        if let tag = state.top?.tag {
          Text(tag)
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(fgMid)
            .lineLimit(1)
        }
      }
    }
    .padding(.leading, 4)
  }
}

private struct ExpandedTrailing: View {
  let state: SentinelActivityAttributes.ContentState
  var body: some View {
    if let start = state.top?.createdAtMs {
      ElapsedText(startMs: start)
        .font(.system(size: 14, weight: .semibold, design: .monospaced))
        .foregroundStyle(activityAccent)
        .padding(.trailing, 4)
    } else {
      EmptyView()
    }
  }
}

private struct ExpandedBottom: View {
  let state: SentinelActivityAttributes.ContentState
  var body: some View {
    if let top = state.top {
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 6) {
          Image(systemName: toolIcon(top.tool))
            .font(.system(size: 10))
            .foregroundStyle(fgMid)
          Text(top.tool.uppercased())
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .tracking(0.12 * 10)
            .foregroundStyle(fgMid)
        }
        Text(top.preview)
          .font(.system(size: 12, design: .monospaced))
          .foregroundStyle(.white)
          .lineLimit(2)
          .multilineTextAlignment(.leading)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(.horizontal, 6)
      .padding(.top, 4)
      .padding(.bottom, 6)
    }
  }

  private func toolIcon(_ tool: String) -> String {
    switch tool {
    case "Bash": return "terminal"
    case "Edit", "Write": return "pencil"
    case "WebFetch": return "globe"
    default: return "wrench.and.screwdriver"
    }
  }
}

// MARK: - Compact Leading (Dynamic Island)

private struct CompactLeadingView: View {
  var body: some View {
    ActivityFlower(color: activityAccent, size: 16)
  }
}

// MARK: - 経過時間

/// `Text(.timer)` の "—s ago" 表現。Live Activity は毎フレーム再描画されないため
/// Text(date, style: .relative) を使うと iOS が自動で更新してくれる。
private struct ElapsedText: View {
  let startMs: Int64
  var body: some View {
    let date = Date(timeIntervalSince1970: TimeInterval(startMs) / 1000)
    Text(date, style: .relative)
  }
}

// MARK: - 8 突点星ロゴ (Activity 専用、Sources/Shared/StarPath と同形)
//
// VigiliActivity target は Sources/SharedMobile + Sources/VigiliActivity しか
// 含まないため、Sources/Shared/StarPath.swift と同じ path 構築をここに inline する。

private struct ActivityFlower: View {
  var color: Color = .white
  var size: CGFloat = 18

  var body: some View {
    Canvas { ctx, _ in
      let rect = CGRect(x: 0, y: 0, width: size, height: size)
      ctx.fill(Self.starPath(in: rect), with: .color(color))
    }
    .frame(width: size, height: size)
  }

  /// `Sources/Shared/StarPath.swift` の path と同じ。
  /// 原典 viewBox 0 0 105 118.52、bbox 中心 (52.5, 59.26)。10 突点 v4 (sharper spikes)。
  static func starPath(in rect: CGRect) -> Path {
    let canvasRadius = min(rect.width, rect.height) / 2
    let extent: CGFloat = 59.26
    let scale = canvasRadius / extent * 0.92
    let cx = rect.midX
    let cy = rect.midY
    @inline(__always) func p(_ x: Double, _ y: Double) -> CGPoint {
      CGPoint(x: cx + (x - 52.5) * scale, y: cy + (y - 59.26) * scale)
    }
    var path = Path()
    path.move(to: p(57.7, 43.49))
    path.addLine(to: p(84.9, 10.89))
    path.addCurve(to: p(85.87, 11.56), control1: p(85.36, 10.34), control2: p(86.22, 10.93))
    path.addLine(to: p(65.32, 48.71))
    path.addCurve(to: p(65.98, 49.57), control1: p(65.07, 49.16), control2: p(65.48, 49.69))
    path.addLine(to: p(103.38, 40.56))
    path.addCurve(to: p(103.79, 41.66), control1: p(104.06, 40.4), control2: p(104.41, 41.35))
    path.addLine(to: p(70.29, 58.62))
    path.addCurve(to: p(70.33, 59.69), control1: p(69.84, 58.85), control2: p(69.86, 59.5))
    path.addLine(to: p(103.89, 73.7))
    path.addCurve(to: p(103.55, 74.83), control1: p(104.55, 73.97), control2: p(104.25, 74.96))
    path.addLine(to: p(66.96, 67.59))
    path.addCurve(to: p(66.34, 68.47), control1: p(66.46, 67.49), control2: p(66.08, 68.03))
    path.addLine(to: p(86.03, 101.74))
    path.addCurve(to: p(85.09, 102.45), control1: p(86.39, 102.35), control2: p(85.58, 102.96))
    path.addLine(to: p(58.58, 74.68))
    path.addCurve(to: p(57.56, 75.04), control1: p(58.23, 74.31), control2: p(57.6, 74.53))
    path.addLine(to: p(54.6, 112.92))
    path.addCurve(to: p(53.42, 112.95), control1: p(54.54, 113.63), control2: p(53.52, 113.66))
    path.addLine(to: p(48.35, 75.31))
    path.addCurve(to: p(47.31, 75.01), control1: p(48.28, 74.8), control2: p(47.64, 74.61))
    path.addLine(to: p(20.11, 107.61))
    path.addCurve(to: p(19.14, 106.94), control1: p(19.65, 108.16), control2: p(18.79, 107.57))
    path.addLine(to: p(39.69, 69.79))
    path.addCurve(to: p(39.03, 68.93), control1: p(39.94, 69.34), control2: p(39.53, 68.81))
    path.addLine(to: p(1.62, 77.95))
    path.addCurve(to: p(1.21, 76.85), control1: p(0.94, 78.11), control2: p(0.59, 77.16))
    path.addLine(to: p(34.71, 59.89))
    path.addCurve(to: p(34.67, 58.82), control1: p(35.16, 59.66), control2: p(35.14, 59.01))
    path.addLine(to: p(1.11, 44.81))
    path.addCurve(to: p(1.45, 43.68), control1: p(0.45, 44.54), control2: p(0.75, 43.55))
    path.addLine(to: p(38.04, 50.92))
    path.addCurve(to: p(38.66, 50.04), control1: p(38.54, 51.02), control2: p(38.92, 50.48))
    path.addLine(to: p(18.98, 16.78))
    path.addCurve(to: p(19.92, 16.07), control1: p(18.62, 16.17), control2: p(19.43, 15.56))
    path.addLine(to: p(46.43, 43.84))
    path.addCurve(to: p(47.45, 43.48), control1: p(46.78, 44.21), control2: p(47.41, 43.99))
    path.addLine(to: p(50.41, 5.6))
    path.addCurve(to: p(51.59, 5.57), control1: p(50.47, 4.89), control2: p(51.49, 4.86))
    path.addLine(to: p(56.66, 43.21))
    path.addCurve(to: p(57.7, 43.51), control1: p(56.73, 43.72), control2: p(57.37, 43.91))
    path.closeSubpath()
    return path
  }
}
