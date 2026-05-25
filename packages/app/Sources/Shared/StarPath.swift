import SwiftUI

/// PWA の `icon.svg` / `Brand.tsx` と共有する Vigili の 10 突点星 (v4 — sharper)。
///
/// 原典は Adobe Illustrator の SVG path (relative 命令の連続)。
/// viewBox 0 0 105 118.52、bbox 中心 (52.5, 59.26)。突点が伸びて鋭く、 bbox は
/// y 5.57..112.95 まで広がる (前の v3 より縦に長い)。
///
/// SwiftUI 側では `path.move/addLine/addCurve` のみで構成しなおして再現する。
/// (CGPath には SVG d-string パーサが無いため、絶対座標を事前計算してハードコード)
///
/// `starPath(in: rect)` を呼ぶと、与えられた rect の中心に等倍で fit した Path を返す。
enum StarPath {

  /// 星本来の viewBox 半分 (= bbox 中心 Y)。canvasRadius / extent で scale を決める。
  static let extent: CGFloat = 59.26

  /// 与えられた正方形 rect の中央に、星を 0.92 倍で fit させた Path を返す。
  /// `marginRatio` を渡せば余白を増減できる (1.0 = canvas いっぱい、0.7 = 30% 余白)。
  static func path(in rect: CGRect, marginRatio: CGFloat = 0.92) -> Path {
    let canvasRadius = min(rect.width, rect.height) / 2
    let scale = canvasRadius / extent * marginRatio
    let cx = rect.midX
    let cy = rect.midY

    @inline(__always) func p(_ x: Double, _ y: Double) -> CGPoint {
      CGPoint(x: cx + (x - 52.5) * scale, y: cy + (y - 59.26) * scale)
    }

    var path = Path()
    // 以下、SVG path "M57.7,43.49 ... Z" (10 突点星 v4 — sharper) を移植したもの。
    path.move(to: p(57.7, 43.49))
    path.addLine(to: p(84.9, 10.89))
    path.addCurve(to: p(85.87, 11.56), control1: p(85.36, 10.34), control2: p(86.22, 10.93))
    path.addLine(to: p(65.32, 48.71))
    path.addCurve(to: p(65.98, 49.57), control1: p(65.07, 49.16), control2: p(65.48, 49.69))
    path.addLine(to: p(103.38, 40.56))
    path.addCurve(to: p(103.79, 41.66), control1: p(104.06, 40.4), control2: p(104.41, 41.35))
    path.addLine(to: p(70.29, 58.62))
    path.addCurve(to: p(70.33, 59.69), control1: p(69.84, 58.85), control2: p(69.86, 59.5))
    path.addLine(to: p(103.89, 73.7))
    path.addCurve(to: p(103.55, 74.83), control1: p(104.55, 73.97), control2: p(104.25, 74.96))
    path.addLine(to: p(66.96, 67.59))
    path.addCurve(to: p(66.34, 68.47), control1: p(66.46, 67.49), control2: p(66.08, 68.03))
    path.addLine(to: p(86.03, 101.74))
    path.addCurve(to: p(85.09, 102.45), control1: p(86.39, 102.35), control2: p(85.58, 102.96))
    path.addLine(to: p(58.58, 74.68))
    path.addCurve(to: p(57.56, 75.04), control1: p(58.23, 74.31), control2: p(57.6, 74.53))
    path.addLine(to: p(54.6, 112.92))
    path.addCurve(to: p(53.42, 112.95), control1: p(54.54, 113.63), control2: p(53.52, 113.66))
    path.addLine(to: p(48.35, 75.31))
    path.addCurve(to: p(47.31, 75.01), control1: p(48.28, 74.8), control2: p(47.64, 74.61))
    path.addLine(to: p(20.11, 107.61))
    path.addCurve(to: p(19.14, 106.94), control1: p(19.65, 108.16), control2: p(18.79, 107.57))
    path.addLine(to: p(39.69, 69.79))
    path.addCurve(to: p(39.03, 68.93), control1: p(39.94, 69.34), control2: p(39.53, 68.81))
    path.addLine(to: p(1.62, 77.95))
    path.addCurve(to: p(1.21, 76.85), control1: p(0.94, 78.11), control2: p(0.59, 77.16))
    path.addLine(to: p(34.71, 93.81))
    path.addCurve(to: p(34.75, 94.88), control1: p(34.26, 94.04), control2: p(34.28, 94.69))
    path.addLine(to: p(1.11, 44.81))
    path.addCurve(to: p(1.45, 43.68), control1: p(0.45, 44.54), control2: p(0.75, 43.55))
    path.addLine(to: p(38.04, 50.92))
    path.addCurve(to: p(38.66, 50.04), control1: p(38.54, 51.02), control2: p(38.92, 50.48))
    path.addLine(to: p(18.98, 16.78))
    path.addCurve(to: p(19.92, 16.07), control1: p(18.62, 16.17), control2: p(19.43, 15.56))
    path.addLine(to: p(46.43, 43.84))
    path.addCurve(to: p(47.45, 43.48), control1: p(46.78, 44.21), control2: p(47.41, 43.99))
    path.addLine(to: p(50.41, 5.6))
    path.addCurve(to: p(51.59, 5.57), control1: p(50.47, 4.89), control2: p(51.49, 4.86))
    path.addLine(to: p(56.66, 43.21))
    path.addCurve(to: p(57.7, 43.51), control1: p(56.73, 43.72), control2: p(57.37, 43.91))
    path.closeSubpath()
    return path
  }
}
