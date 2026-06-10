import SwiftUI

// MARK: - StandingWatchLedger (リッチ統計カード)
//
// ヘルスアプリ風の統計ビュー。待機画面 (pending 空) の下部に出る。
//
// レイアウト:
//   ────────────────────────────────────────
//   TODAY              ■ 14 AUTO ■ 162 YOU ■ 103 BLOCKED
//   244                              ↑ +12 vs yesterday
//   ████████████░░░░░░░░░░░░░░░░░░░  ← セグメントバー
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

  private var deltaColor: Color {
    guard let d = delta else { return Theme.fgDim }
    return d > 0 ? Theme.green : Theme.fgDim
  }

  /// デルタ表示 View。正=緑の上向き三角、負=暗い下向き三角、ゼロ=テキストのみ。
  @ViewBuilder
  private var deltaView: some View {
    if let d = delta {
      HStack(alignment: .center, spacing: 4) {
        if d != 0 {
          Image(systemName: d > 0 ? "arrowtriangle.up.fill" : "arrowtriangle.down.fill")
            .font(.system(size: 8, weight: .bold))
            .foregroundStyle(deltaColor)
        }
        Text(d == 0 ? "= yesterday" : "+\(abs(d)) vs yesterday")
          .monoLabel(11, tracking: 0.14)
          .foregroundStyle(deltaColor)
      }
      .padding(.leading, 10)
    }
  }

  // MARK: - body

  // セクション間の余白: hairline を VStack の独立した要素として置く。
  // overlay 方式は hairline とテキストが同じ y に来てしまうため使わない。
  private let gap: CGFloat = 14

  // MARK: - 自動承認率バー (LP の sage→coral グラデーション)

  /// auto / (auto + byYou + blocked) の割合。データ未着なら nil。
  private var autoRate: CGFloat? {
    guard stats != nil else { return nil }
    let total = autoApproved + humanApproved + blocked
    guard total > 0 else { return 0 }
    return CGFloat(autoApproved) / CGFloat(total)
  }

  private var automationBar: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        // トラック
        RoundedRectangle(cornerRadius: 999)
          .fill(Theme.border)
        // 塗り: sage(緑) → coral のグラデーション
        if let rate = autoRate {
          RoundedRectangle(cornerRadius: 999)
            .fill(
              LinearGradient(
                colors: [Theme.green, Theme.accent],
                startPoint: .leading,
                endPoint: .trailing
              )
            )
            .frame(width: max(4, geo.size.width * rate))
            .animation(.spring(response: 0.6, dampingFraction: 0.7), value: rate)
        }
      }
    }
    .frame(height: 5)
  }

  var body: some View {
    VStack(spacing: 0) {
      hairline
      headlineRow        // TODAY + 内訳凡例
      decisionBar        // セグメントバー
      hairline
      statusRow
    }
    .padding(.horizontal, 24)
    .padding(.bottom, 16)
  }

  // MARK: - Headline: TODAY + 内訳凡例 (右端) / 数字 + 変化量 (右端)

  private var headlineRow: some View {
    VStack(alignment: .leading, spacing: 4) {
      // TODAY ← → ■ AUTO ■ YOU ■ BLOCKED
      HStack(alignment: .center, spacing: 0) {
        Text("TODAY")
          .monoLabel(10, tracking: 0.5)
          .foregroundStyle(Theme.fgDim)
        Spacer(minLength: 8)
        HStack(spacing: 10) {
          kpiLegend(autoApproved,  "AUTO",    Theme.green)
          kpiLegend(humanApproved, "YOU",     Theme.accent)
          kpiLegend(blocked,       "BLOCKED", Theme.fgFaint.opacity(0.35))
        }
      }
      // 数字（左）と変化量（右端）を同一ベースラインに
      HStack(alignment: .firstTextBaseline, spacing: 0) {
        if stats != nil {
          Text("\(todayTotal)")
            .font(.mono(28, weight: .bold))
            .foregroundStyle(Theme.fg)
            .contentTransition(.numericText())
            .animation(.spring(response: 0.4, dampingFraction: 0.7), value: todayTotal)
        } else {
          Text("--")
            .font(.mono(28, weight: .bold))
            .foregroundStyle(Theme.fgDim)
        }
        Spacer(minLength: 8)
        deltaView
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.top, 12)
    .padding(.bottom, 4)
  }

  // MARK: - セグメントバーのみ

  private var autoFrac:  CGFloat {
    let t = autoApproved + humanApproved + blocked
    return t > 0 ? CGFloat(autoApproved) / CGFloat(t) : 0
  }
  private var humanFrac: CGFloat {
    let t = autoApproved + humanApproved + blocked
    return t > 0 ? CGFloat(humanApproved) / CGFloat(t) : 0
  }

  private var decisionBar: some View {
    VStack(spacing: 6) {
      // セグメントバー
      GeometryReader { geo in
        HStack(spacing: 2) {
          RoundedRectangle(cornerRadius: 2)
            .fill(Theme.green)
            .frame(width: max(stats != nil ? 2 : 0, geo.size.width * autoFrac))
          RoundedRectangle(cornerRadius: 2)
            .fill(Theme.accent)
            .frame(width: max(stats != nil ? 2 : 0, geo.size.width * humanFrac))
          RoundedRectangle(cornerRadius: 2)
            .fill(Theme.fgFaint.opacity(0.35))
            .frame(maxWidth: .infinity)
        }
      }
      .frame(height: 5)
    }
    .padding(.top, 4)
    .padding(.bottom, 10)
  }

  private func kpiLegend(_ value: Int, _ label: String, _ color: Color) -> some View {
    HStack(spacing: 4) {
      RoundedRectangle(cornerRadius: 1.5)
        .fill(color)
        .frame(width: 8, height: 8)
      Text(stats == nil ? "--" : "\(value)")
        .font(.mono(11, weight: .semibold))
        .foregroundStyle(Theme.fg)
        .contentTransition(.numericText())
      Text(label)
        .monoLabel(10, tracking: 0.12)
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
    .padding(.top, 14)
    .padding(.bottom, 12)
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
