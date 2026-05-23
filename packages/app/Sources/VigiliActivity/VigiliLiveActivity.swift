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
  /// 原典 viewBox 0 0 105 118.52、bbox 中心 (52.5, 59.26)。
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
    path.move(to: p(60.75, 45.25))
    path.addLine(to: p(86.35, 25.94))
    path.addCurve(to: p(87.2, 26.77), control1: p(86.9, 25.52), control2: p(87.61, 26.21))
    path.addLine(to: p(68.43, 52.77))
    path.addCurve(to: p(68.84, 53.72), control1: p(68.16, 53.14), control2: p(68.39, 53.66))
    path.addLine(to: p(101, 58.17))
    path.addCurve(to: p(101.01, 59.36), control1: p(101.69, 58.26), control2: p(101.7, 59.25))
    path.addLine(to: p(68.91, 64.48))
    path.addCurve(to: p(68.51, 65.42), control1: p(68.47, 64.55), control2: p(68.26, 65.06))
    path.addLine(to: p(83.51, 86.77))
    path.addCurve(to: p(82.68, 87.62), control1: p(83.89, 87.32), control2: p(83.24, 87.99))
    path.addLine(to: p(61.03, 73.07))
    path.addCurve(to: p(60.1, 73.49), control1: p(60.66, 72.82), control2: p(60.16, 73.05))
    path.addLine(to: p(55.73, 105.77))
    path.addCurve(to: p(54.54, 105.79), control1: p(55.64, 106.46), control2: p(54.65, 106.47))
    path.addLine(to: p(49.34, 73.63))
    path.addCurve(to: p(48.38, 73.24), control1: p(49.27, 73.18), control2: p(48.74, 72.97))
    path.addLine(to: p(22.78, 92.55))
    path.addCurve(to: p(21.93, 91.72), control1: p(22.23, 92.97), control2: p(21.52, 92.28))
    path.addLine(to: p(40.69, 65.73))
    path.addCurve(to: p(40.28, 64.78), control1: p(40.96, 65.36), control2: p(40.73, 64.84))
    path.addLine(to: p(4.48, 60.32))
    path.addCurve(to: p(4.47, 59.12), control1: p(3.78, 60.23), control2: p(3.77, 59.22))
    path.addLine(to: p(40.2, 53.99))
    path.addCurve(to: p(40.61, 53.05), control1: p(40.65, 53.93), control2: p(40.87, 53.41))
    path.addLine(to: p(25.62, 31.72))
    path.addCurve(to: p(26.45, 30.87), control1: p(25.24, 31.17), control2: p(25.89, 30.5))
    path.addLine(to: p(48.1, 45.41))
    path.addCurve(to: p(49.03, 44.99), control1: p(48.47, 45.66), control2: p(48.98, 45.43))
    path.addLine(to: p(53.4, 11))
    path.addCurve(to: p(54.59, 10.99), control1: p(53.49, 10.31), control2: p(54.49, 10.3))
    path.addLine(to: p(59.8, 44.85))
    path.addCurve(to: p(60.76, 45.24), control1: p(59.87, 45.3), control2: p(60.39, 45.51))
    path.closeSubpath()
    return path
  }
}
