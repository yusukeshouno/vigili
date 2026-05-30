import SwiftUI

/// pending が無い時に出る "standing watch" 画面。
///
/// Claude Design の "Vigili Waiting Screens" / **Probing** バリエーションを
/// 移植した深海ソナー風レーダー:
/// - 同心円のリングを 3 本 (半径比 1.0 / 0.66 / 0.33) coral で薄く重ねる
/// - ゆっくり回る掃引ビーム (sweep): 120° かけて透明へ抜ける残像付きの扇形を
///   `sweepPeriod` 秒で 1 周させる (conic-gradient 相当を AngularGradient で再現)
/// - 中央にブランドの星マーク。微かに呼吸 + glow halo で「生きている」感を出す
///
/// (※ ランダムに湧く amber の contact 点はユーザ要望で一旦オフにしてある)
///
/// **登場 (intro) アニメーション:**
/// 承認直後に画面全体が「急に」出ると違和感があるため、出現してから時刻で
/// 段階的に立ち上げる:
///   1. **ライン** … 同心円リングが外側から順に `trim` で描かれる
///   2. **星** … 中央のブランド星が overshoot 付きでポップイン
///   3. **レーダー** … 掃引ビームがフェードイン
///   4. **文字** … "standing watch" が下からふわっと現れる
/// 各要素の進捗は出現時刻 `appearedAt` からの経過秒 `e` から決定的に導出する。
///
/// **設計上の制約 (なぜ Timer 駆動か):**
/// `MenuBarExtra(.window)` のポップオーバー内では `TimelineView(.animation)` や
/// `.repeatForever()` の連続アニメーションが tick しない (state 変化駆動の
/// transition だけが動く)。そこで `Timer.publish(... in: .common)` を main run loop
/// に流して毎フレーム `@State now` を更新し、body 内で **全アニメーション値を時刻 t
/// から決定的に導出** する。登場アニメも同じ ticker で進めるので popover でも確実に
/// 動く。pending が再び空になり View が挿入されるたびに `onAppear` で `appearedAt` を
/// 更新し、毎回 intro を再生する。
struct StandingWatchView: View {
  let wsState: DaemonWsClient.State

  /// レーダー全体の外径。Mac popover (idealWidth 420) と iOS 画面の両方に収まる値。
  var radarSize: CGFloat = 300

  /// 掃引ビームが 1 周する秒数 (大きいほどゆっくり)。
  private let sweepPeriod: Double = 6.0
  /// リングの半径比 (外側から)。
  private let ringScales: [CGFloat] = [1.0, 0.66, 0.33]

  // MARK: 登場 (intro) のステージング時刻 (出現からの秒)
  // ライン → 星 → 掃引ビーム → 文字 の順に立ち上がる。
  private let ringsDelay: Double = 0.0
  private let ringsDur: Double = 0.55
  private let ringStagger: Double = 0.13
  private let starDelay: Double = 0.6
  private let starDur: Double = 0.55
  private let sweepDelay: Double = 1.2
  private let sweepDur: Double = 0.65
  private let textDelay: Double = 1.75
  private let textDur: Double = 0.5

  /// 60fps の駆動タイマー (.common モードで popover 内でも止まらない)。
  private let ticker = Timer.publish(every: 1.0 / 60.0, on: .main, in: .common).autoconnect()
  @State private var now = Date()
  /// この View が現れた時刻 (出現アニメの基準)。再登場のたびに更新する。
  @State private var appearedAt: TimeInterval? = nil

  var body: some View {
    let t = now.timeIntervalSinceReferenceDate
    let e = appearedAt.map { t - $0 } ?? 0
    let textP = ramp(e, delay: textDelay, dur: textDur)

    VStack(spacing: 28) {
      radar(t: t, e: e)
        .frame(width: radarSize, height: radarSize)

      Text("standing watch")
        .monoLabel(10, weight: .medium, tracking: 0.20)
        .foregroundStyle(Theme.fgMid)
        .opacity(textP)
        .offset(y: (1 - textP) * 6)

      if case .failed(let msg) = wsState {
        Text("ws: \(msg)")
          .font(.mono(9))
          .foregroundStyle(Theme.fgFaint)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 8)
          .opacity(textP)
      }
    }
    .onAppear {
      appearedAt = Date().timeIntervalSinceReferenceDate
      now = Date()
    }
    .onReceive(ticker) { now = $0 }
  }

  // MARK: - レーダー本体

  private func radar(t: TimeInterval, e: Double) -> some View {
    // 中央星の呼吸 (4 秒周期、0..1)
    let pulse = 0.5 + 0.5 * sin(t / 4.0 * .pi * 2)
    // 掃引角度 (0 → 360°/sweepPeriod 秒)
    let sweepAngle = (t / sweepPeriod).truncatingRemainder(dividingBy: 1.0) * 360.0

    // 登場進捗。
    let starP = ramp(e, delay: starDelay, dur: starDur)
    let starPop = easeOutBack(clamp01((e - starDelay) / starDur))  // 終端で少し弾む
    let sweepP = ramp(e, delay: sweepDelay, dur: sweepDur)

    return ZStack {
      // ── ① 同心円リング (外側から trim で描かれる) ────────────────────
      ForEach(Array(ringScales.enumerated()), id: \.offset) { idx, s in
        let rp = ramp(e, delay: ringsDelay + Double(idx) * ringStagger, dur: ringsDur)
        Circle()
          .trim(from: 0, to: rp)
          .stroke(Theme.accent.opacity(0.20), lineWidth: 1)
          .rotationEffect(.degrees(-90))  // 12 時方向から時計回りに描く
          .frame(width: radarSize * s, height: radarSize * s)
      }

      // ── ③ 掃引ビーム (残像付き / フェードイン) ─────────────────────
      // 先端が最も濃く、後方 120° にかけて透明へ抜ける扇形を回転させる。
      Circle()
        .fill(
          AngularGradient(
            gradient: Gradient(stops: [
              .init(color: Theme.accent.opacity(0.34), location: 0.0),
              .init(color: Theme.accent.opacity(0.0), location: 0.333),
              .init(color: Theme.accent.opacity(0.0), location: 1.0),
            ]),
            center: .center
          )
        )
        .frame(width: radarSize, height: radarSize)
        .rotationEffect(.degrees(sweepAngle))
        .blendMode(.screen)
        .opacity(sweepP)

      // ── ② 中央のブランド星 + glow halo (リングの次にポップイン) ──────
      Circle()
        .fill(Theme.accent.opacity((0.05 + 0.12 * pulse) * starP))
        .frame(width: 42 + 14 * CGFloat(pulse), height: 42 + 14 * CGFloat(pulse))
        .blur(radius: 15)

      FlowerLogo(color: Theme.accent.opacity(0.9 + 0.1 * pulse), size: 24)
        .scaleEffect((0.4 + 0.6 * CGFloat(starPop)) * (1 + 0.05 * CGFloat(pulse)))
        .opacity(starP)
        .shadow(color: Theme.accent.opacity(0.45 * pulse * starP), radius: 7 * pulse)
    }
  }

  // MARK: - イージング

  /// delay 秒待ってから dur 秒かけて 0→1 に立ち上がる (cubic ease-out)。
  private func ramp(_ elapsed: Double, delay: Double, dur: Double) -> Double {
    easeOutCubic(clamp01((elapsed - delay) / dur))
  }
  private func clamp01(_ x: Double) -> Double { min(max(x, 0), 1) }
  private func easeOutCubic(_ x: Double) -> Double { 1 - pow(1 - x, 3) }
  /// 終端で少しオーバーシュートする (星のポップ用)。
  private func easeOutBack(_ x: Double) -> Double {
    let c1 = 1.70158
    let c3 = c1 + 1
    return 1 + c3 * pow(x - 1, 3) + c1 * pow(x - 1, 2)
  }
}
