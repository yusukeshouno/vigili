import SwiftUI
import WidgetKit

/// Vigili — 承認待ち件数を表示する Widget。
///
/// 3 サイズ:
/// - small (155×155): 件数 + brand mark
/// - medium (338×155): 件数 + 今日の allow/deny 集計
/// - large (338×338): 件数 + 集計 + 直近 pending の一覧 (最大 5 件)
///
/// データ源: `~/.vigili/widget-state.json` (Sentinel.app が書き、ここが読む)。
struct VigiliPendingWidget: Widget {
  let kind: String = "VigiliPendingWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: VigiliWidgetProvider()) { entry in
      VigiliWidgetEntryView(entry: entry)
        .containerBackground(.fill.tertiary, for: .widget)
    }
    .configurationDisplayName("Vigili Pending")
    .description("承認待ちの件数と今日の集計を表示。")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

// MARK: - Timeline

struct VigiliWidgetEntry: TimelineEntry {
  let date: Date
  let state: WidgetState
}

struct VigiliWidgetProvider: TimelineProvider {
  func placeholder(in context: Context) -> VigiliWidgetEntry {
    VigiliWidgetEntry(date: Date(), state: .placeholder)
  }

  func getSnapshot(in context: Context, completion: @escaping (VigiliWidgetEntry) -> Void) {
    completion(VigiliWidgetEntry(date: Date(), state: WidgetState.read()))
  }

  /// TimelineProvider は WidgetCenter.reloadAllTimelines() で再呼び出しされる。
  /// プッシュ的に main app から reload するので、ここでは fallback として
  /// 30 秒後に「次回」を入れる (app が落ちている時に widget が完全停止しないように)。
  func getTimeline(in context: Context, completion: @escaping (Timeline<VigiliWidgetEntry>) -> Void) {
    let entry = VigiliWidgetEntry(date: Date(), state: WidgetState.read())
    let next = Calendar.current.date(byAdding: .second, value: 30, to: entry.date) ?? entry.date
    completion(Timeline(entries: [entry], policy: .after(next)))
  }
}

// MARK: - View

struct VigiliWidgetEntryView: View {
  @Environment(\.widgetFamily) private var family
  let entry: VigiliWidgetEntry

  var body: some View {
    switch family {
    case .systemMedium: MediumView(state: entry.state)
    case .systemLarge: LargeView(state: entry.state)
    default: SmallView(state: entry.state)
    }
  }
}

// MARK: - Sub views

private let accent = Color(red: 0xc9 / 255.0, green: 0x64 / 255.0, blue: 0x42 / 255.0)
private let dim = Color.secondary

/// 4 花弁マーク (PWA Brand と同じパス、scale 1.75 を再現)。
private struct PetalMark: View {
  let size: CGFloat
  let color: Color

  var body: some View {
    Canvas { context, _ in
      let center = CGPoint(x: size / 2, y: size / 2)
      let path = Self.petalPath(scale: 1.75, center: center)
      context.fill(path, with: .color(color))
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }

  /// SwiftUI Path で 4 弁 + 中心ドットを構築。
  /// build-icons.mjs の SVG path "M 16 14 C 13 11 13 7 16 4 C 19 7 19 11 16 14 Z" を移植。
  /// inner 32×32 coord に対し、center を canvas 中心に合わせて scale で拡大する。
  static func petalPath(scale: CGFloat, center: CGPoint) -> Path {
    var path = Path()
    let inner = CGPoint(x: 16, y: 16) // SVG 内の rotate 中心
    let toScreen = { (p: CGPoint) -> CGPoint in
      CGPoint(
        x: center.x + (p.x - inner.x) * scale,
        y: center.y + (p.y - inner.y) * scale
      )
    }

    // 上向き花弁の path
    func petal(at angle: Angle) -> Path {
      var p = Path()
      // SVG: M 16 14 → C 13 11, 13 7, 16 4 → C 19 7, 19 11, 16 14
      let a = CGAffineTransform(translationX: inner.x, y: inner.y)
        .rotated(by: angle.radians)
        .translatedBy(x: -inner.x, y: -inner.y)
      let m = CGPoint(x: 16, y: 14).applying(a)
      let c1a = CGPoint(x: 13, y: 11).applying(a)
      let c1b = CGPoint(x: 13, y: 7).applying(a)
      let to1 = CGPoint(x: 16, y: 4).applying(a)
      let c2a = CGPoint(x: 19, y: 7).applying(a)
      let c2b = CGPoint(x: 19, y: 11).applying(a)
      let to2 = CGPoint(x: 16, y: 14).applying(a)
      p.move(to: toScreen(m))
      p.addCurve(to: toScreen(to1), control1: toScreen(c1a), control2: toScreen(c1b))
      p.addCurve(to: toScreen(to2), control1: toScreen(c2a), control2: toScreen(c2b))
      p.closeSubpath()
      return p
    }

    path.addPath(petal(at: .degrees(0)))
    path.addPath(petal(at: .degrees(90)))
    path.addPath(petal(at: .degrees(180)))
    path.addPath(petal(at: .degrees(270)))
    // 中心ドット
    let dotCenter = toScreen(inner)
    path.addEllipse(
      in: CGRect(
        x: dotCenter.x - 1.5 * scale,
        y: dotCenter.y - 1.5 * scale,
        width: 3 * scale,
        height: 3 * scale
      )
    )
    return path
  }
}

private struct SmallView: View {
  let state: WidgetState

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(spacing: 6) {
        PetalMark(size: 18, color: accent)
        Text("Vigili")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(.primary)
        Spacer()
        if !state.connected || state.isStale {
          Image(systemName: "wifi.slash")
            .font(.system(size: 10))
            .foregroundStyle(dim)
        }
      }
      Spacer(minLength: 0)
      Text("\(state.pendingCount)")
        .font(.system(size: 44, weight: .bold, design: .rounded))
        .foregroundStyle(state.pendingCount > 0 ? accent : .primary)
        .contentTransition(.numericText(value: Double(state.pendingCount)))
      Text(state.pendingCount == 1 ? "pending" : "pending")
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(dim)
        .textCase(.lowercase)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct MediumView: View {
  let state: WidgetState

  var body: some View {
    HStack(spacing: 14) {
      // 左: 件数
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 6) {
          PetalMark(size: 16, color: accent)
          Text("Vigili")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.primary)
        }
        Spacer(minLength: 0)
        Text("\(state.pendingCount)")
          .font(.system(size: 48, weight: .bold, design: .rounded))
          .foregroundStyle(state.pendingCount > 0 ? accent : .primary)
          .contentTransition(.numericText(value: Double(state.pendingCount)))
        Text("pending")
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(dim)
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      // 右: 今日の集計
      VStack(alignment: .leading, spacing: 8) {
        Text("Today")
          .font(.system(size: 10, weight: .semibold))
          .foregroundStyle(dim)
          .textCase(.uppercase)
          .tracking(0.8)
        StatRow(label: "allow", value: state.todayAllowCount, color: .secondary)
        StatRow(label: "deny", value: state.todayDenyCount, color: .secondary)
        Spacer(minLength: 0)
        if state.isStale {
          Label("offline", systemImage: "wifi.slash")
            .font(.system(size: 10))
            .foregroundStyle(dim)
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

private struct LargeView: View {
  let state: WidgetState

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .firstTextBaseline) {
        PetalMark(size: 18, color: accent)
        Text("Vigili")
          .font(.system(size: 13, weight: .semibold))
        Spacer()
        if state.isStale {
          Label("offline", systemImage: "wifi.slash")
            .font(.system(size: 10))
            .foregroundStyle(dim)
        }
      }

      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 2) {
          Text("\(state.pendingCount)")
            .font(.system(size: 56, weight: .bold, design: .rounded))
            .foregroundStyle(state.pendingCount > 0 ? accent : .primary)
            .contentTransition(.numericText(value: Double(state.pendingCount)))
          Text("pending")
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(dim)
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 6) {
          Text("Today")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(dim)
            .textCase(.uppercase)
            .tracking(0.8)
          HStack(spacing: 4) {
            Text("\(state.todayAllowCount)")
              .font(.system(size: 16, weight: .semibold, design: .rounded))
              .foregroundStyle(.primary)
            Text("allow")
              .font(.system(size: 10))
              .foregroundStyle(dim)
          }
          HStack(spacing: 4) {
            Text("\(state.todayDenyCount)")
              .font(.system(size: 16, weight: .semibold, design: .rounded))
              .foregroundStyle(.primary)
            Text("deny")
              .font(.system(size: 10))
              .foregroundStyle(dim)
          }
        }
      }

      Divider()

      // 直近の pending リスト
      if state.recentPending.isEmpty {
        VStack(alignment: .leading, spacing: 4) {
          Text("No pending requests")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(.primary)
          Text("All clear.")
            .font(.system(size: 10))
            .foregroundStyle(dim)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      } else {
        VStack(alignment: .leading, spacing: 6) {
          ForEach(state.recentPending.prefix(5), id: \.id) { item in
            HStack(spacing: 6) {
              Circle()
                .fill(accent)
                .frame(width: 4, height: 4)
              Text(item.title)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .truncationMode(.tail)
              Spacer()
              Text("\(item.ageSeconds)s")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(dim)
            }
          }
        }
      }

      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private struct StatRow: View {
  let label: String
  let value: Int
  let color: Color

  var body: some View {
    HStack(spacing: 6) {
      Text("\(value)")
        .font(.system(size: 16, weight: .semibold, design: .rounded))
        .foregroundStyle(.primary)
      Text(label)
        .font(.system(size: 10, weight: .medium))
        .foregroundStyle(color)
    }
  }
}
