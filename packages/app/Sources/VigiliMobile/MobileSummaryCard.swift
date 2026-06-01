import Charts
import SwiftUI

// MARK: - StandingWatchLedger (リッチ統計カード)
//
// ヘルスアプリ風の統計ビュー。待機画面 (pending 空) の下部に出る。
//
// レイアウト:
//   ────────────────────────────────────────
//   Today   47    ↑ +12 vs yesterday
//   ────────────────────────────────────────
//   05      │ 08      │ 03
//   AUTO    │ BY YOU  │ BLOCKED
//   ────────────────────────────────────────
//   7-day activity
//   [██ ▓▓ ░░ ██ ░░ ██ ▓▓]   ← 積み上げバーチャート
//    M   T   W   T   F   S   S
//   ────────────────────────────────────────
//   ● WATCHING · LOCAL                TODAY
//
struct StandingWatchLedger: View {
  @EnvironmentObject private var coordinator: MobileAppCoordinator

  private var stats: StatsBuckets? { coordinator.stats }
  private var week: [DailyBucket] { coordinator.weekStats }

  // MARK: - 今日の集計 helpers

  private var humanApproved: Int {
    guard let s = stats else { return 0 }
    return (s.bySource["human-pwa"] ?? 0) + (s.bySource["human-cli"] ?? 0)
  }

  private var autoApproved: Int {
    guard let s = stats else { return 0 }
    return max(0, s.byDecision.allow - humanApproved)
  }

  private var blocked: Int { stats?.byDecision.deny ?? 0 }
  private var todayTotal: Int { stats?.total ?? 0 }

  // 2 桁ゼロ詰め。未受信は "--"。
  private func cell(_ n: Int) -> String {
    stats == nil ? "--" : String(format: "%02d", n)
  }

  // MARK: - 前日比 delta

  /// 昨日のバケット (week[1])。
  private var yesterday: DailyBucket? { week.count > 1 ? week[1] : nil }

  /// 今日 - 昨日 の件数差。nil = データ未着。
  private var delta: Int? {
    guard stats != nil, let y = yesterday else { return nil }
    return todayTotal - y.total
  }

  private var deltaLabel: String {
    guard let d = delta else { return "" }
    if d == 0 { return "= yesterday" }
    let sign = d > 0 ? "↑ +" : "↓ "
    return "\(sign)\(abs(d)) vs yesterday"
  }

  private var deltaColor: Color {
    guard let d = delta else { return Theme.fgDim }
    // 件数増 = 活動量増 → アクセント、減 = dim、ゼロ = dim
    return d > 0 ? Theme.accent : Theme.fgDim
  }

  // MARK: - body

  var body: some View {
    VStack(spacing: 0) {
      headlineRow
      hairline.padding(.top, 14)
      kpiRow.padding(.top, 14)
      if !week.isEmpty {
        hairline.padding(.top, 14)
        weekChart.padding(.top, 14)
      }
      statusRow.padding(.top, 12)
    }
    .padding(.horizontal, 24)
    .padding(.bottom, 30)
  }

  // MARK: - Headline (Today N  ↑ +12 vs yesterday)

  private var headlineRow: some View {
    HStack(alignment: .firstTextBaseline, spacing: 0) {
      Text("Today")
        .monoLabel(11, tracking: 0.16)
        .foregroundStyle(Theme.fgDim)
      Spacer(minLength: 8)
      if stats != nil {
        Text("\(todayTotal)")
          .font(.mono(26, weight: .semibold))
          .foregroundStyle(Theme.fg)
          .contentTransition(.numericText())
          .animation(.spring(response: 0.4, dampingFraction: 0.7), value: todayTotal)
        if !deltaLabel.isEmpty {
          Text(deltaLabel)
            .monoLabel(11, tracking: 0.14)
            .foregroundStyle(deltaColor)
            .padding(.leading, 10)
        }
      } else {
        Text("--")
          .font(.mono(26, weight: .semibold))
          .foregroundStyle(Theme.fgDim)
      }
    }
    .overlay(alignment: .top) { hairline }
    .padding(.top, 16)
  }

  // MARK: - KPI 3 カラム

  private var kpiRow: some View {
    HStack(spacing: 0) {
      kpiColumn(cell(autoApproved), label: "auto", first: true)
      kpiColumn(cell(humanApproved), label: "by you", first: false)
      kpiColumn(cell(blocked), label: "blocked", first: false)
    }
  }

  private func kpiColumn(_ value: String, label: String, first: Bool) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(value)
        .font(.mono(22, weight: .medium))
        .foregroundStyle(Theme.fg)
        .contentTransition(.numericText())
      Text(label)
        .monoLabel(10, tracking: 0.16)
        .foregroundStyle(Theme.fgDim)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.bottom, 14)
    .padding(.leading, first ? 0 : 16)
    .overlay(alignment: .leading) {
      if !first {
        Rectangle().fill(Theme.border).frame(width: 1)
      }
    }
  }

  // MARK: - 7-day stacked bar chart

  /// バー 1 本分のデータ (auto / human / blocked の 3 層)。
  private struct BarEntry: Identifiable {
    let id: String  // date "YYYY-MM-DD"
    let label: String  // 曜日
    let auto: Int
    let human: Int
    let blocked: Int
    var total: Int { auto + human + blocked }
  }

  private var barEntries: [BarEntry] {
    // week は index 0=今日 → 古い順に並べ替えて表示 (左=古, 右=今日)
    week.reversed().map { b in
      BarEntry(id: b.date, label: b.weekdayLetter,
               auto: b.auto, human: b.humanApproved, blocked: b.denied)
    }
  }

  /// 週のピーク件数 (y 軸 max 用)。最低 5 にして細すぎを防ぐ。
  private var peakTotal: Int {
    max(5, barEntries.map { $0.total }.max() ?? 0)
  }

  @ViewBuilder
  private var weekChart: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("7-day activity")
        .monoLabel(10, tracking: 0.16)
        .foregroundStyle(Theme.fgDim)

      Chart {
        ForEach(barEntries) { entry in
          // 積み上げ: auto (底) → human (中) → blocked (上)
          BarMark(
            x: .value("Day", entry.label),
            y: .value("Auto", entry.auto),
            stacking: .standard
          )
          .foregroundStyle(Theme.green.opacity(0.75))
          .cornerRadius(2)

          BarMark(
            x: .value("Day", entry.label),
            y: .value("By you", entry.human),
            stacking: .standard
          )
          .foregroundStyle(Theme.accent.opacity(0.85))
          .cornerRadius(2)

          BarMark(
            x: .value("Day", entry.label),
            y: .value("Blocked", entry.blocked),
            stacking: .standard
          )
          .foregroundStyle(Theme.red.opacity(0.70))
          .cornerRadius(2)
        }
      }
      .chartXAxis {
        AxisMarks(values: .automatic) { _ in
          AxisValueLabel()
            .font(.mono(9))
            .foregroundStyle(Theme.fgDim)
        }
      }
      .chartYAxis(.hidden)
      .chartYScale(domain: 0...peakTotal)
      .frame(height: 72)

      // 凡例 (小 pill 3 つ)
      HStack(spacing: 12) {
        legendPill(color: Theme.green.opacity(0.75), label: "auto")
        legendPill(color: Theme.accent.opacity(0.85), label: "by you")
        legendPill(color: Theme.red.opacity(0.70), label: "blocked")
      }
    }
  }

  private func legendPill(color: Color, label: String) -> some View {
    HStack(spacing: 4) {
      RoundedRectangle(cornerRadius: 2)
        .fill(color)
        .frame(width: 10, height: 6)
      Text(label)
        .monoLabel(9, tracking: 0.12)
        .foregroundStyle(Theme.fgDim)
    }
  }

  // MARK: - ステータスストリップ

  private var statusRow: some View {
    HStack(spacing: 9) {
      Circle()
        .fill(statusDotColor)
        .frame(width: 6, height: 6)
      Text(statusLabel)
        .monoLabel(11, tracking: 0.18)
        .foregroundStyle(Theme.fgDim)
      Spacer(minLength: 0)
      Text("today")
        .monoLabel(11, tracking: 0.18)
        .foregroundStyle(Theme.fgDim)
    }
    .overlay(alignment: .top) { hairline }
    .padding(.top, 4)
  }

  private var statusDotColor: Color {
    switch coordinator.wsState {
    case .connected: return Theme.green
    default: return Theme.fgDim
    }
  }

  private var statusLabel: String {
    switch coordinator.wsState {
    case .connected:
      switch coordinator.activeRoute {
      case .lan: return "watching · local"
      case .account, .relay: return "watching · remote"
      case .none: return "watching"
      }
    case .connecting: return "connecting…"
    case .disconnected: return "disconnected"
    case .failed: return "connection lost"
    }
  }

  private var hairline: some View {
    Rectangle().fill(Theme.border).frame(height: 1)
  }
}
