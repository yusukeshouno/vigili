import SwiftUI

/// pending が無い時に出る "standing watch" 画面。
///
/// 観測中であることを視覚化するため:
/// - 星ロゴを中央に置き、外周に同心円のリング (波紋) を 3 本重ねる
/// - リングが 4 秒周期で外側に拡張しながらフェード (echo location 風)
/// - ロゴ自体も ±5% で呼吸 (breathing)
/// - 約 18 秒に一度、ロゴが ease-in-out で 1 回転する (生存サインの "wink")
/// - 色は coral (accent) の薄め
///
/// `TimelineView(.animation)` を使うとフレームごとに body が呼び直されるので
/// `withAnimation` / `@State` のループより滑らかで、ループ境界の jump も無い。
struct StandingWatchView: View {
  let wsState: DaemonWsClient.State

  /// 波紋・呼吸の 1 サイクル秒数。
  private let period: Double = 4.0
  /// ロゴが回転する間隔 (この秒数ごとに 1 回くるりと回る)。
  private let spinCycle: Double = 18.0
  /// 1 回転に要する秒数 (= 上記のうち動いてる時間)。
  private let spinDuration: Double = 1.4

  var body: some View {
    VStack(spacing: 16) {
      TimelineView(.animation) { context in
        let t = context.date.timeIntervalSinceReferenceDate
        let phase = CGFloat((t / period).truncatingRemainder(dividingBy: 1.0))

        // spin: 18 秒周期のうち最初の 1.4 秒だけ 0 → 360° を ease-in-out で進める
        let spinPhase = t.truncatingRemainder(dividingBy: spinCycle)
        let spinRotation: Double = {
          guard spinPhase < spinDuration else { return 0 }
          let progress = spinPhase / spinDuration
          let eased = easeInOut(progress)
          return eased * 360
        }()

        ZStack {
          // 波紋を 4 本に増やし、よりダイナミックに
          ForEach(0..<4) { i in
            ripple(phase: phase, index: i)
          }
          FlowerLogo(color: Theme.accent.opacity(0.9), size: 32)
            // 呼吸: 振れ幅を 8% に拡大してよりダイナミックに
            .scaleEffect(1.0 + 0.08 * sin(phase * .pi * 2))
            .rotationEffect(.degrees(spinRotation))
        }
        .frame(width: 110, height: 110)
      }

      Text("standing watch")
        .font(.mono(10, weight: .medium))
        .tracking(0.20 * 10)
        .foregroundStyle(Theme.fgMid)
        .textCase(.uppercase)

      if case .failed(let msg) = wsState {
        Text("ws: \(msg)")
          .font(.mono(9))
          .foregroundStyle(Theme.fgFaint)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 8)
      }
    }
  }

  /// 三次の ease-in-out (0 → 1 を S 字に補間)。
  private func easeInOut(_ x: Double) -> Double {
    return x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2
  }

  /// 波紋リング。`index` で位相をずらし、波が連続して広がるように見せる。
  /// 半径 20 → 54pt に拡大、不透明度も 0.65 からフェード。
  private func ripple(phase: CGFloat, index: Int) -> some View {
    let offset = CGFloat(index) / 4.0
    var local = phase + offset
    while local >= 1.0 { local -= 1.0 }
    let radius = 20 + local * 34
    let opacity = max(0, 0.65 * (1 - local))
    let lineWidth = max(0.5, 1.5 * (1 - local))
    return Circle()
      .stroke(Theme.accent.opacity(Double(opacity)), lineWidth: lineWidth)
      .frame(width: radius * 2, height: radius * 2)
  }
}
