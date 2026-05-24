import AppKit

/// MenuBarExtra の label に渡す用の 10 突点星アイコン (NSImage)。
///
/// SwiftUI の `Canvas` / `Path` を MenuBarExtra label に直接入れると
/// AppKit 側で正しくサイズ・描画されず黒丸になることがある。
/// `NSImage(size:flipped:drawingHandler:)` で AppKit ネイティブに描き、
/// `isTemplate = true` でメニューバーの明暗に追従させる。
///
/// 形状は `Sources/Shared/StarPath.swift` と同じ Adobe Illustrator v3 path (10 突点)。
/// AppKit (NSBezierPath) で独立に再現する (StarPath は SwiftUI Path 専用なので
/// 共有できない)。
enum MenuBarIconImage {
  /// 一度生成したものをキャッシュ (サイズ違いは現状無いので 1 つで OK)。
  /// 他アプリのメニューバーアイコンと揃えるため 22pt。
  static let shared: NSImage = make(size: 22)

  static func make(size: CGFloat) -> NSImage {
    let img = NSImage(
      size: NSSize(width: size, height: size),
      flipped: false
    ) { rect in
      drawStar(in: rect)
      return true
    }
    // template = メニューバーで自動的に white に反転、ホバー時のハイライトも自動
    img.isTemplate = true
    return img
  }

  /// `Sources/Shared/StarPath.swift` と同じ Bezier 構造を AppKit で描画。
  /// 原典 viewBox 0 0 105 118.52、bbox 中心 (52.51, 59.26)。10 突点 v3。
  /// メニューバーで沈まないよう margin 0.85 (= canvas 半径の 85% で fit)。
  private static func drawStar(in rect: NSRect) {
    let canvasRadius = min(rect.width, rect.height) / 2
    let starExtent: CGFloat = 59.26
    let scale = canvasRadius / starExtent * 0.85
    let cx = rect.midX
    let cy = rect.midY

    @inline(__always) func p(_ x: Double, _ y: Double) -> NSPoint {
      NSPoint(x: cx + (x - 52.51) * scale, y: cy + (y - 59.26) * scale)
    }

    let path = NSBezierPath()
    path.move(to: p(58.7, 40.35))
    path.line(to: p(83.34, 12.99))
    path.curve(to: p(84.47, 13.76), controlPoint1: p(83.88, 12.39), controlPoint2: p(84.83, 13.04))
    path.line(to: p(67.89, 46.63))
    path.curve(to: p(68.64, 47.62), controlPoint1: p(67.63, 47.14), controlPoint2: p(68.07, 47.73))
    path.line(to: p(101.06, 41.3))
    path.curve(to: p(101.54, 42.57), controlPoint1: p(101.82, 41.15), controlPoint2: p(102.21, 42.19))
    path.line(to: p(73.83, 58.53))
    path.curve(to: p(73.88, 59.75), controlPoint1: p(73.35, 58.81), controlPoint2: p(73.38, 59.51))
    path.line(to: p(101.92, 73.04))
    path.curve(to: p(101.52, 74.34), controlPoint1: p(102.64, 73.38), controlPoint2: p(102.31, 74.46))
    path.line(to: p(66.87, 69.26))
    path.curve(to: p(66.18, 70.3), controlPoint1: p(66.29, 69.18), controlPoint2: p(65.88, 69.8))
    path.line(to: p(83.77, 98.91))
    path.curve(to: p(82.71, 99.77), controlPoint1: p(84.19, 99.6), controlPoint2: p(83.29, 100.33))
    path.line(to: p(59.75, 77.74))
    path.curve(to: p(58.59, 78.15), controlPoint1: p(59.34, 77.35), controlPoint2: p(58.66, 77.59))
    path.line(to: p(54.63, 110.53))
    path.curve(to: p(53.27, 110.57), controlPoint1: p(54.53, 111.31), controlPoint2: p(53.41, 111.35))
    path.line(to: p(47.51, 78.49))
    path.curve(to: p(46.32, 78.15), controlPoint1: p(47.41, 77.93), controlPoint2: p(46.7, 77.72))
    path.line(to: p(21.68, 105.51))
    path.curve(to: p(20.55, 104.74), controlPoint1: p(21.14, 106.11), controlPoint2: p(20.19, 105.46))
    path.line(to: p(37.13, 71.87))
    path.curve(to: p(36.38, 70.88), controlPoint1: p(37.39, 71.36), controlPoint2: p(36.95, 70.77))
    path.line(to: p(3.96, 77.2))
    path.curve(to: p(3.48, 75.93), controlPoint1: p(3.2, 77.35), controlPoint2: p(2.81, 76.31))
    path.line(to: p(31.19, 59.97))
    path.curve(to: p(31.14, 58.75), controlPoint1: p(31.67, 59.69), controlPoint2: p(31.64, 58.99))
    path.line(to: p(3.09, 45.47))
    path.curve(to: p(3.49, 44.17), controlPoint1: p(2.37, 45.13), controlPoint2: p(2.7, 44.05))
    path.line(to: p(38.14, 49.25))
    path.curve(to: p(38.83, 48.21), controlPoint1: p(38.72, 49.33), controlPoint2: p(39.13, 48.71))
    path.line(to: p(21.24, 19.6))
    path.curve(to: p(22.3, 18.74), controlPoint1: p(20.82, 18.91), controlPoint2: p(21.72, 18.18))
    path.line(to: p(45.26, 40.77))
    path.curve(to: p(46.42, 40.36), controlPoint1: p(45.67, 41.16), controlPoint2: p(46.35, 40.92))
    path.line(to: p(50.38, 7.98))
    path.curve(to: p(51.74, 7.94), controlPoint1: p(50.48, 7.2), controlPoint2: p(51.6, 7.16))
    path.line(to: p(57.5, 40.02))
    path.curve(to: p(58.69, 40.36), controlPoint1: p(57.6, 40.58), controlPoint2: p(58.31, 40.79))
    path.close()

    NSColor.black.setFill()  // template image なので fill は無視される (auto invert)
    path.fill()
  }
}
