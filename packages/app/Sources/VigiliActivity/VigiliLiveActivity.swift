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

// MARK: - 4 弁花ロゴ (Activity 専用、Brand.swift と同形)

private struct ActivityFlower: View {
  var color: Color = .white
  var size: CGFloat = 18

  var body: some View {
    Canvas { ctx, _ in
      let petalScale: CGFloat = 1.1
      let baseScale = size / 32.0 * petalScale
      let cx = size / 2
      let cy = size / 2
      for rotation in stride(from: 0, to: 360, by: 90) {
        var t = CGAffineTransform.identity
        t = t.translatedBy(x: cx, y: cy)
        t = t.rotated(by: CGFloat(rotation) * .pi / 180)
        t = t.scaledBy(x: baseScale, y: baseScale)
        t = t.translatedBy(x: -16, y: -16)
        var path = Path()
        path.move(to: CGPoint(x: 16, y: 14))
        path.addCurve(
          to: CGPoint(x: 16, y: 4),
          control1: CGPoint(x: 13, y: 11),
          control2: CGPoint(x: 13, y: 7)
        )
        path.addCurve(
          to: CGPoint(x: 16, y: 14),
          control1: CGPoint(x: 19, y: 7),
          control2: CGPoint(x: 19, y: 11)
        )
        path.closeSubpath()
        ctx.fill(path.applying(t), with: .color(color))
      }
      let dotR: CGFloat = 1.6 * baseScale
      ctx.fill(
        Path(ellipseIn: CGRect(x: cx - dotR, y: cy - dotR, width: dotR * 2, height: dotR * 2)),
        with: .color(color)
      )
    }
    .frame(width: size, height: size)
  }
}
