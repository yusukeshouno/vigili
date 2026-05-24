import SwiftUI

/// PWA の `Brand.tsx` と同じ 10 突点星ロゴ (v4 sharper) を SwiftUI の Shape で直接描く。
/// 原典 viewBox 0 0 105 118.52 の SVG path を `StarPath` 経由で再現。
/// 名前は `FlowerLogo` のままだが、4 弁花 → 8 突星 → 10 突星 v3 → v4 と差し替え済み。
struct FlowerLogo: View {
  var color: Color = .primary
  var size: CGFloat = 18

  var body: some View {
    Canvas { ctx, _ in
      let rect = CGRect(x: 0, y: 0, width: size, height: size)
      let path = StarPath.path(in: rect)
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
