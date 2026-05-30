import SwiftUI

/// 待機画面 (standing watch) 下部の **静かな 3 カラム台帳フッター**。
///
/// Claude Design "Vigili — standing watch" の **Footer B (quiet three-column
/// ledger)** を移植したもの。旧 `VigiliSummaryCard` は角丸・塗り背景・影・
/// 緑→コーラルのグラデバー・重複した Vigili ロゴ・「TODAY」ピルを持つ「浮いた
/// 通知カード」で、主役であるべきレーダーと張り合っていた。ここではそれを解体し、
/// ヘアラインで仕切るだけの recessive なストリップに落とす — レーダーが主役に戻る。
///
/// レイアウト:
/// ```
///   ────────────────────────────
///    05      │ 08      │ 03
///    AUTO    │ BY YOU  │ BLOCKED
///   ────────────────────────────
///   ● WATCHING · LOCAL      TODAY
/// ```
///
/// **なぜ pending ではなく今日の集計か:** この台帳が出るのは pending が空の待機画面
/// (pending があれば承認画面に切り替わる) なので「N waiting」は常に 0 で情報量が無い。
/// 代わりに daemon が WS で push する今日の観測可能性サマリー
/// (CLAUDE.md「1 日の終わりに自動許可した N 件を振り返れる」) を 3 値で見せる:
/// - **auto**   … Vigili が自動承認した件数 (= allow 総数 − 人手 allow)。タップ肩代わり数。
/// - **by you** … 自分でタップして承認した件数。
/// - **blocked**… ブロック (deny) した件数。
///
/// データは `coordinator.stats` (WS の `stats` メッセージ)。未受信なら各カラムを
/// "--" にして、桁ぞろえを保ったまま「まだ集計が来ていない」ことを示す。
struct StandingWatchLedger: View {
  @EnvironmentObject private var coordinator: MobileAppCoordinator

  private var stats: StatsBuckets? { coordinator.stats }

  /// 人間が明示承認した件数 (PWA/iOS タップ + CLI)。
  private var humanApproved: Int {
    guard let s = stats else { return 0 }
    return (s.bySource["human-pwa"] ?? 0) + (s.bySource["human-cli"] ?? 0)
  }

  /// Vigili が自動で承認した件数 = allow 総数 − 人手 allow。タップを肩代わりした数。
  private var autoApproved: Int {
    guard let s = stats else { return 0 }
    return max(0, s.byDecision.allow - humanApproved)
  }

  private var blocked: Int { stats?.byDecision.deny ?? 0 }

  /// 2 桁ゼロ詰め (design の `05` / `08` / `03`)。未受信は "--"。
  private func cell(_ n: Int) -> String {
    stats == nil ? "--" : String(format: "%02d", n)
  }

  var body: some View {
    VStack(spacing: 0) {
      // ── 3 カラム台帳 (ヘアラインで上端と各カラム左端を仕切る) ──────────
      HStack(spacing: 0) {
        column(cell(autoApproved), label: "auto", first: true)
        column(cell(humanApproved), label: "by you", first: false)
        column(cell(blocked), label: "blocked", first: false)
      }
      .overlay(alignment: .top) { hairline }

      // ── ステータスストリップ (marginTop 4 → hairline → paddingTop 14) ──
      HStack(spacing: 9) {
        Circle()
          .fill(Theme.green)
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
      .overlay(alignment: .top) { hairline }
      .padding(.top, 4)
    }
    .padding(.horizontal, 24)
    .padding(.bottom, 30)
  }

  /// 1 カラム: 大きめ mono 数字 + 小さい uppercase ラベル。
  /// 2 本目以降は左端に 1px のヘアラインを引き、内容を 16pt 右に寄せる。
  private func column(_ value: String, label: String, first: Bool) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(value)
        .font(.mono(22, weight: .medium))
        .foregroundStyle(Theme.fg)
      Text(label)
        .monoLabel(10, tracking: 0.16)
        .foregroundStyle(Theme.fgDim)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.top, 16)
    .padding(.bottom, 14)
    .padding(.leading, first ? 0 : 16)
    .overlay(alignment: .leading) {
      if !first {
        Rectangle().fill(Theme.border).frame(width: 1)
      }
    }
  }

  private var hairline: some View {
    Rectangle().fill(Theme.border).frame(height: 1)
  }

  /// 接続状態 (pending 空が前提なので route を反映)。
  /// `.lan` = Mac に直結 (同一 LAN / Tailscale) → "local"、`.relay` = クラウド relay 経由 → "remote"。
  private var statusLabel: String {
    switch coordinator.wsState {
    case .connected:
      switch coordinator.activeRoute {
      case .lan: return "watching · local"
      case .relay: return "watching · remote"
      case .none: return "watching"
      }
    case .connecting: return "connecting…"
    case .disconnected: return "disconnected"
    case .failed: return "connection lost"
    }
  }
}
