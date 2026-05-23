import SwiftUI

/// PWA の `Brand.tsx` と同じ 8 突点星ロゴを SwiftUI の Shape で直接描く。
/// Asset Catalog 経由だと build cache / template-rendering で不安定なため、
/// vector 計算を Swift 側に持ってきて確実に描画する。
///
/// 原典 viewBox 0 0 105 118.52、bbox 中心 (52.5, 59.26)。
/// 名前は `FlowerLogo` のままだが、4 弁花から 8 突星に差し替え済み (リブランド)。
struct FlowerLogo: View {
  /// 塗り色。pendingCount=0 のときは fgMid、>0 で accent に。
  var color: Color = .primary
  var size: CGFloat = 18

  /// 16 頂点 (8 突点 + 8 凹点)。原典 SVG の polygon points と同じ順序。
  private static let starPoints: [CGPoint] = [
    CGPoint(x: 59.94, y: 45.86), CGPoint(x: 89.54, y: 23.53),
    CGPoint(x: 67.84, y: 53.59), CGPoint(x: 105, y: 58.73),
    CGPoint(x: 67.95, y: 64.65), CGPoint(x: 85.38, y: 89.44),
    CGPoint(x: 60.22, y: 72.54), CGPoint(x: 55.18, y: 118.52),
    CGPoint(x: 49.17, y: 72.66), CGPoint(x: 19.57, y: 94.98),
    CGPoint(x: 41.27, y: 64.93), CGPoint(x: 0, y: 59.79),
    CGPoint(x: 41.15, y: 53.87), CGPoint(x: 23.73, y: 29.08),
    CGPoint(x: 48.89, y: 45.98), CGPoint(x: 53.93, y: 0),
  ]
  private static let starCenter = CGPoint(x: 52.5, y: 59.26)
  /// 星の最大半径 (中心 → 最遠突点)。viewBox 高さの半分 = 59.26。
  private static let starExtent: CGFloat = 59.26

  var body: some View {
    Canvas { ctx, _ in
      let canvasCenter = CGPoint(x: size / 2, y: size / 2)
      // canvas 半径いっぱいの 92% で fit (薄い margin)
      let scale = (size / 2) / Self.starExtent * 0.92

      var path = Path()
      for (i, p) in Self.starPoints.enumerated() {
        let pt = CGPoint(
          x: canvasCenter.x + (p.x - Self.starCenter.x) * scale,
          y: canvasCenter.y + (p.y - Self.starCenter.y) * scale
        )
        if i == 0 {
          path.move(to: pt)
        } else {
          path.addLine(to: pt)
        }
      }
      path.closeSubpath()
      ctx.fill(path, with: .color(color))
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
