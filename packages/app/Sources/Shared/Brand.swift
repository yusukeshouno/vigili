import SwiftUI

/// PWA の `Brand.tsx` と同じ 4 弁花ロゴを SwiftUI の Shape で直接描く。
/// Asset Catalog 経由だと build cache / template-rendering で不安定なため、
/// vector 計算を Swift 側に持ってきて確実に描画する。
///
/// viewBox は 32×32、花は中心 (16,16) 周りの 4 回回転対称。
struct FlowerLogo: View {
  /// 1 弁の塗り色。pendingCount=0 のときは fgMid、>0 で accent に。
  var color: Color = .primary
  var size: CGFloat = 18

  var body: some View {
    Canvas { ctx, _ in
      let scale = size / 32.0
      let cx = size / 2
      let cy = size / 2

      // 1 弁を 4 回転して描く
      for rotation in stride(from: 0, to: 360, by: 90) {
        var t = CGAffineTransform.identity
        t = t.translatedBy(x: cx, y: cy)
        t = t.rotated(by: CGFloat(rotation) * .pi / 180)
        t = t.scaledBy(x: scale, y: scale)
        t = t.translatedBy(x: -16, y: -16)

        // PWA と同じ Bezier path: M 16 14 C 13 11 13 7 16 4 C 19 7 19 11 16 14 Z
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

        let transformed = path.applying(t)
        ctx.fill(transformed, with: .color(color))
      }

      // 中央の小さい円 (r=1.5 を 1.55 倍 ≈ 2.3)
      let dotPath = Path(ellipseIn: CGRect(
        x: cx - 1.2 * scale * 1.55,
        y: cy - 1.2 * scale * 1.55,
        width: 2.4 * scale * 1.55,
        height: 2.4 * scale * 1.55
      ))
      ctx.fill(dotPath, with: .color(color))
    }
    .frame(width: size, height: size)
  }
}

/// PWA `tagHue` と同じハッシュ → HSL。SwiftUI 用に HSL を作る簡易実装。
/// 同じタグ文字列なら同じ色になるので、毎回視認性が保たれる。
enum AgentColor {
  static func color(for tag: String?) -> Color {
    guard let tag = tag, !tag.isEmpty else {
      return Color(hex: "#5a5350")  // neutral warm gray
    }
    let h = hash(tag) % 360
    return hsl(hue: Double(h), saturation: 0.50, lightness: 0.55)
  }

  private static func hash(_ s: String) -> Int {
    var h = 0
    for c in s.unicodeScalars {
      h = ((h &<< 5) &- h) &+ Int(c.value)
    }
    return abs(h)
  }

  /// HSL → RGB → SwiftUI.Color
  private static func hsl(hue: Double, saturation: Double, lightness: Double) -> Color {
    let h = hue / 360.0
    let s = saturation
    let l = lightness
    let q = l < 0.5 ? l * (1 + s) : l + s - l * s
    let p = 2 * l - q
    let r = hueToRgb(p: p, q: q, t: h + 1.0 / 3.0)
    let g = hueToRgb(p: p, q: q, t: h)
    let b = hueToRgb(p: p, q: q, t: h - 1.0 / 3.0)
    return Color(.sRGB, red: r, green: g, blue: b, opacity: 1.0)
  }

  private static func hueToRgb(p: Double, q: Double, t: Double) -> Double {
    var t = t
    if t < 0 { t += 1 }
    if t > 1 { t -= 1 }
    if t < 1.0 / 6.0 { return p + (q - p) * 6 * t }
    if t < 1.0 / 2.0 { return q }
    if t < 2.0 / 3.0 { return p + (q - p) * (2.0 / 3.0 - t) * 6 }
    return p
  }
}
