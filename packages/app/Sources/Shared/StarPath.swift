import SwiftUI

/// PWA の `icon.svg` / `Brand.tsx` と共有する Vigili の 10 突点星。
///
/// 原典は Adobe Illustrator の SVG path (relative 命令の連続)。
/// viewBox 0 0 105 118.52、bbox 中心 (52.51, 59.26)。各突点には軽い curve が入る (v3)。
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
      CGPoint(x: cx + (x - 52.51) * scale, y: cy + (y - 59.26) * scale)
    }

    var path = Path()
    // 以下、SVG path "M58.7,40.35 ... Z" (10 突点星 v3) を移植したもの。
    path.move(to: p(58.7, 40.35))
    path.addLine(to: p(83.34, 12.99))
    path.addCurve(to: p(84.47, 13.76), control1: p(83.88, 12.39), control2: p(84.83, 13.04))
    path.addLine(to: p(67.89, 46.63))
    path.addCurve(to: p(68.64, 47.62), control1: p(67.63, 47.14), control2: p(68.07, 47.73))
    path.addLine(to: p(101.06, 41.3))
    path.addCurve(to: p(101.54, 42.57), control1: p(101.82, 41.15), control2: p(102.21, 42.19))
    path.addLine(to: p(73.83, 58.53))
    path.addCurve(to: p(73.88, 59.75), control1: p(73.35, 58.81), control2: p(73.38, 59.51))
    path.addLine(to: p(101.92, 73.04))
    path.addCurve(to: p(101.52, 74.34), control1: p(102.64, 73.38), control2: p(102.31, 74.46))
    path.addLine(to: p(66.87, 69.26))
    path.addCurve(to: p(66.18, 70.3), control1: p(66.29, 69.18), control2: p(65.88, 69.8))
    path.addLine(to: p(83.77, 98.91))
    path.addCurve(to: p(82.71, 99.77), control1: p(84.19, 99.6), control2: p(83.29, 100.33))
    path.addLine(to: p(59.75, 77.74))
    path.addCurve(to: p(58.59, 78.15), control1: p(59.34, 77.35), control2: p(58.66, 77.59))
    path.addLine(to: p(54.63, 110.53))
    path.addCurve(to: p(53.27, 110.57), control1: p(54.53, 111.31), control2: p(53.41, 111.35))
    path.addLine(to: p(47.51, 78.49))
    path.addCurve(to: p(46.32, 78.15), control1: p(47.41, 77.93), control2: p(46.7, 77.72))
    path.addLine(to: p(21.68, 105.51))
    path.addCurve(to: p(20.55, 104.74), control1: p(21.14, 106.11), control2: p(20.19, 105.46))
    path.addLine(to: p(37.13, 71.87))
    path.addCurve(to: p(36.38, 70.88), control1: p(37.39, 71.36), control2: p(36.95, 70.77))
    path.addLine(to: p(3.96, 77.2))
    path.addCurve(to: p(3.48, 75.93), control1: p(3.2, 77.35), control2: p(2.81, 76.31))
    path.addLine(to: p(31.19, 59.97))
    path.addCurve(to: p(31.14, 58.75), control1: p(31.67, 59.69), control2: p(31.64, 58.99))
    path.addLine(to: p(3.09, 45.47))
    path.addCurve(to: p(3.49, 44.17), control1: p(2.37, 45.13), control2: p(2.7, 44.05))
    path.addLine(to: p(38.14, 49.25))
    path.addCurve(to: p(38.83, 48.21), control1: p(38.72, 49.33), control2: p(39.13, 48.71))
    path.addLine(to: p(21.24, 19.6))
    path.addCurve(to: p(22.3, 18.74), control1: p(20.82, 18.91), control2: p(21.72, 18.18))
    path.addLine(to: p(45.26, 40.77))
    path.addCurve(to: p(46.42, 40.36), control1: p(45.67, 41.16), control2: p(46.35, 40.92))
    path.addLine(to: p(50.38, 7.98))
    path.addCurve(to: p(51.74, 7.94), control1: p(50.48, 7.2), control2: p(51.6, 7.16))
    path.addLine(to: p(57.5, 40.02))
    path.addCurve(to: p(58.69, 40.36), control1: p(57.6, 40.58), control2: p(58.31, 40.79))
    path.closeSubpath()
    return path
  }
}
