import SwiftUI

/// PWA の `icon.svg` / `Brand.tsx` と共有する Vigili の 8 突点星。
///
/// 原典は Adobe Illustrator の SVG path (relative 命令の連続)。
/// viewBox 0 0 105 118.52、bbox 中心 (52.5, 59.26)。各突点には軽い curve が入る (v2)。
///
/// SwiftUI 側では `path.move/addLine/addCurve` のみで構成しなおして再現する。
/// (CGPath には SVG d-string パーサが無いため、絶対座標を事前計算してハードコード)
///
/// `starPath(in: rect)` を呼ぶと、与えられた rect の中心に等倍で fit した Path を返す。
enum StarPath {

  /// 星本来の viewBox 高さ (= 突点間の最大寸法、中心 → 上 or 下 突点の距離)。
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
    // 以下、SVG path "M60.75,45.25 ... Z" を移植したもの。
    path.move(to: p(60.75, 45.25))
    path.addLine(to: p(86.35, 25.94))
    path.addCurve(to: p(87.2, 26.77), control1: p(86.9, 25.52), control2: p(87.61, 26.21))
    path.addLine(to: p(68.43, 52.77))
    path.addCurve(to: p(68.84, 53.72), control1: p(68.16, 53.14), control2: p(68.39, 53.66))
    path.addLine(to: p(101, 58.17))
    path.addCurve(to: p(101.01, 59.36), control1: p(101.69, 58.26), control2: p(101.7, 59.25))
    path.addLine(to: p(68.91, 64.48))
    path.addCurve(to: p(68.51, 65.42), control1: p(68.47, 64.55), control2: p(68.26, 65.06))
    path.addLine(to: p(83.51, 86.77))
    path.addCurve(to: p(82.68, 87.62), control1: p(83.89, 87.32), control2: p(83.24, 87.99))
    path.addLine(to: p(61.03, 73.07))
    path.addCurve(to: p(60.1, 73.49), control1: p(60.66, 72.82), control2: p(60.16, 73.05))
    path.addLine(to: p(55.73, 105.77))
    path.addCurve(to: p(54.54, 105.79), control1: p(55.64, 106.46), control2: p(54.65, 106.47))
    path.addLine(to: p(49.34, 73.63))
    path.addCurve(to: p(48.38, 73.24), control1: p(49.27, 73.18), control2: p(48.74, 72.97))
    path.addLine(to: p(22.78, 92.55))
    path.addCurve(to: p(21.93, 91.72), control1: p(22.23, 92.97), control2: p(21.52, 92.28))
    path.addLine(to: p(40.69, 65.73))
    path.addCurve(to: p(40.28, 64.78), control1: p(40.96, 65.36), control2: p(40.73, 64.84))
    path.addLine(to: p(4.48, 60.32))
    path.addCurve(to: p(4.47, 59.12), control1: p(3.78, 60.23), control2: p(3.77, 59.22))
    path.addLine(to: p(40.2, 53.99))
    path.addCurve(to: p(40.61, 53.05), control1: p(40.65, 53.93), control2: p(40.87, 53.41))
    path.addLine(to: p(25.62, 31.72))
    path.addCurve(to: p(26.45, 30.87), control1: p(25.24, 31.17), control2: p(25.89, 30.5))
    path.addLine(to: p(48.1, 45.41))
    path.addCurve(to: p(49.03, 44.99), control1: p(48.47, 45.66), control2: p(48.98, 45.43))
    path.addLine(to: p(53.4, 11))
    path.addCurve(to: p(54.59, 10.99), control1: p(53.49, 10.31), control2: p(54.49, 10.3))
    path.addLine(to: p(59.8, 44.85))
    path.addCurve(to: p(60.76, 45.24), control1: p(59.87, 45.3), control2: p(60.39, 45.51))
    path.closeSubpath()
    return path
  }
}
