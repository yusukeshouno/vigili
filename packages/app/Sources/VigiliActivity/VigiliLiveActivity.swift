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
        .activityBackgroundTint(Color(red: 38 / 255, green: 38 / 255, blue: 36 / 255))
        .activitySystemActionForegroundColor(Color(red: 201 / 255, green: 100 / 255, blue: 66 / 255))
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

// MARK: - 共通色

/// 共有 Theme と同じ coral (#c96442)。
private let activityAccent = Color(red: 201 / 255, green: 100 / 255, blue: 66 / 255)
private let bgRise = Color(red: 45 / 255, green: 43 / 255, blue: 41 / 255)
private let fgMid = Color.white.opacity(0.62)

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
  /// 原典 viewBox 0 0 105 118.52、bbox 中心 (52.51, 59.26)。10 突点 v3。
  static func starPath(in rect: CGRect) -> Path {
    let canvasRadius = min(rect.width, rect.height) / 2
    let extent: CGFloat = 59.26
    let scale = canvasRadius / extent * 0.92
    let cx = rect.midX
    let cy = rect.midY
    @inline(__always) func p(_ x: Double, _ y: Double) -> CGPoint {
      CGPoint(x: cx + (x - 52.51) * scale, y: cy + (y - 59.26) * scale)
    }
    var path = Path()
    path.move(to: p(58.7, 40.35))
    path.addLine(to: p(83.34, 12.99))
    path.addCurve(to: p(84.47, 13.76), control1: p(83.88, 12.39), control2: p(84.83, 13.04))
    path.addLine(to: p(67.89, 46.63))
    path.addCurve(to: p(68.64, 47.62), control1: p(67.63, 47.14), control2: p(68.07, 47.73))
    path.addLine(to: p(101.06, 41.3))
    path.addCurve(to: p(101.54, 42.57), control1: p(101.82, 41.15), control2: p(102.21, 42.19))
    path.addLine(to: p(73.83, 58.53))
    path.addCurve(to: p(73.88, 59.75), control1: p(73.35, 58.81), control2: p(73.38, 59.51))
    path.addLine(to: p(101.92, 73.04))
    path.addCurve(to: p(101.52, 74.34), control1: p(102.64, 73.38), control2: p(102.31, 74.46))
    path.addLine(to: p(66.87, 69.26))
    path.addCurve(to: p(66.18, 70.3), control1: p(66.29, 69.18), control2: p(65.88, 69.8))
    path.addLine(to: p(83.77, 98.91))
    path.addCurve(to: p(82.71, 99.77), control1: p(84.19, 99.6), control2: p(83.29, 100.33))
    path.addLine(to: p(59.75, 77.74))
    path.addCurve(to: p(58.59, 78.15), control1: p(59.34, 77.35), control2: p(58.66, 77.59))
    path.addLine(to: p(54.63, 110.53))
    path.addCurve(to: p(53.27, 110.57), control1: p(54.53, 111.31), control2: p(53.41, 111.35))
    path.addLine(to: p(47.51, 78.49))
    path.addCurve(to: p(46.32, 78.15), control1: p(47.41, 77.93), control2: p(46.7, 77.72))
    path.addLine(to: p(21.68, 105.51))
    path.addCurve(to: p(20.55, 104.74), control1: p(21.14, 106.11), control2: p(20.19, 105.46))
    path.addLine(to: p(37.13, 71.87))
    path.addCurve(to: p(36.38, 70.88), control1: p(37.39, 71.36), control2: p(36.95, 70.77))
    path.addLine(to: p(3.96, 77.2))
    path.addCurve(to: p(3.48, 75.93), control1: p(3.2, 77.35), control2: p(2.81, 76.31))
    path.addLine(to: p(31.19, 59.97))
    path.addCurve(to: p(31.14, 58.75), control1: p(31.67, 59.69), control2: p(31.64, 58.99))
    path.addLine(to: p(3.09, 45.47))
    path.addCurve(to: p(3.49, 44.17), control1: p(2.37, 45.13), control2: p(2.7, 44.05))
    path.addLine(to: p(38.14, 49.25))
    path.addCurve(to: p(38.83, 48.21), control1: p(38.72, 49.33), control2: p(39.13, 48.71))
    path.addLine(to: p(21.24, 19.6))
    path.addCurve(to: p(22.3, 18.74), control1: p(20.82, 18.91), control2: p(21.72, 18.18))
    path.addLine(to: p(45.26, 40.77))
    path.addCurve(to: p(46.42, 40.36), control1: p(45.67, 41.16), control2: p(46.35, 40.92))
    path.addLine(to: p(50.38, 7.98))
    path.addCurve(to: p(51.74, 7.94), control1: p(50.48, 7.2), control2: p(51.6, 7.16))
    path.addLine(to: p(57.5, 40.02))
    path.addCurve(to: p(58.69, 40.36), control1: p(57.6, 40.58), control2: p(58.31, 40.79))
    path.closeSubpath()
    return path
  }
}
