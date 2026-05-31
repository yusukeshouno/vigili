import AppIntents
import SwiftUI
import WidgetKit

/// widget の Allow/Deny ボタンが発火する App Intent (macOS 14+ interactive widget)。
/// サンドボックスの widget は daemon に直接届かないので、決定を自分のコンテナの
/// `decisions/<request_id>.json` に書く。非サンドボックスの host (AppCoordinator) が
/// それを watch して daemon に適用する (逆方向のコンテナ IPC、SPEC §9.2 と対称)。
struct DecideRequestIntent: AppIntent {
  static let title: LocalizedStringResource = "Decide pending request"
  /// Shortcuts アプリには出さない (widget 内部用)。
  static let isDiscoverable: Bool = false

  @Parameter(title: "Request ID") var requestId: String
  @Parameter(title: "Decision") var decision: String

  init() {}
  init(requestId: String, decision: String) {
    self.requestId = requestId
    self.decision = decision
  }

  func perform() async throws -> some IntentResult {
    WidgetState.writeDecision(id: requestId, decision: decision)
    return .result()
  }
}

/// Vigili — 承認待ち件数を表示する Widget。
///
/// 3 サイズ:
/// - small (155×155): 件数 + brand mark
/// - medium (338×155): 件数 + 今日の allow/deny 集計
/// - large (338×338): 件数 + 集計 + 直近 pending の一覧 (最大 5 件)
///
/// データ源: App Group 共有コンテナの `widget-state.json` (Vigili.app が書き、ここが読む)。
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

private let accent = Theme.accent
private let dim = Color.secondary  // システム適応色 (widget 背景に合わせて自動調整)

/// 8 突点星 (Vigili brand mark)。Sources/Shared/StarPath.swift と同じ path。
private struct PetalMark: View {
  let size: CGFloat
  let color: Color

  var body: some View {
    Canvas { context, _ in
      let rect = CGRect(x: 0, y: 0, width: size, height: size)
      let path = StarPath.path(in: rect, marginRatio: 0.84)
      context.fill(path, with: .color(color))
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
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
              Spacer(minLength: 4)
              // タップで widget→host にコンテナ経由で決定を流す (App Intent)。
              Button(intent: DecideRequestIntent(requestId: item.id, decision: "deny")) {
                Image(systemName: "xmark")
                  .font(.system(size: 10, weight: .bold))
                  .foregroundStyle(.secondary)
                  .frame(width: 22, height: 22)
                  .background(Circle().fill(.secondary.opacity(0.12)))
              }
              .buttonStyle(.plain)
              Button(intent: DecideRequestIntent(requestId: item.id, decision: "allow")) {
                Image(systemName: "checkmark")
                  .font(.system(size: 10, weight: .bold))
                  .foregroundStyle(accent)
                  .frame(width: 22, height: 22)
                  .background(Circle().fill(accent.opacity(0.15)))
              }
              .buttonStyle(.plain)
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
