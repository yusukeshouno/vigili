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
  /// 原典 viewBox 0 0 105 118.52、bbox 中心 (52.5, 59.26)。10 突点 v4 (sharper spikes)。
  /// メニューバーで沈まないよう margin 0.85 (= canvas 半径の 85% で fit)。
  private static func drawStar(in rect: NSRect) {
    let canvasRadius = min(rect.width, rect.height) / 2
    let starExtent: CGFloat = 59.26
    let scale = canvasRadius / starExtent * 0.85
    let cx = rect.midX
    let cy = rect.midY

    @inline(__always) func p(_ x: Double, _ y: Double) -> NSPoint {
      NSPoint(x: cx + (x - 52.5) * scale, y: cy + (y - 59.26) * scale)
    }

    let path = NSBezierPath()
    path.move(to: p(57.7, 43.49))
    path.line(to: p(84.9, 10.89))
    path.curve(to: p(85.87, 11.56), controlPoint1: p(85.36, 10.34), controlPoint2: p(86.22, 10.93))
    path.line(to: p(65.32, 48.71))
    path.curve(to: p(65.98, 49.57), controlPoint1: p(65.07, 49.16), controlPoint2: p(65.48, 49.69))
    path.line(to: p(103.38, 40.56))
    path.curve(to: p(103.79, 41.66), controlPoint1: p(104.06, 40.4), controlPoint2: p(104.41, 41.35))
    path.line(to: p(70.29, 58.62))
    path.curve(to: p(70.33, 59.69), controlPoint1: p(69.84, 58.85), controlPoint2: p(69.86, 59.5))
    path.line(to: p(103.89, 73.7))
    path.curve(to: p(103.55, 74.83), controlPoint1: p(104.55, 73.97), controlPoint2: p(104.25, 74.96))
    path.line(to: p(66.96, 67.59))
    path.curve(to: p(66.34, 68.47), controlPoint1: p(66.46, 67.49), controlPoint2: p(66.08, 68.03))
    path.line(to: p(86.03, 101.74))
    path.curve(to: p(85.09, 102.45), controlPoint1: p(86.39, 102.35), controlPoint2: p(85.58, 102.96))
    path.line(to: p(58.58, 74.68))
    path.curve(to: p(57.56, 75.04), controlPoint1: p(58.23, 74.31), controlPoint2: p(57.6, 74.53))
    path.line(to: p(54.6, 112.92))
    path.curve(to: p(53.42, 112.95), controlPoint1: p(54.54, 113.63), controlPoint2: p(53.52, 113.66))
    path.line(to: p(48.35, 75.31))
    path.curve(to: p(47.31, 75.01), controlPoint1: p(48.28, 74.8), controlPoint2: p(47.64, 74.61))
    path.line(to: p(20.11, 107.61))
    path.curve(to: p(19.14, 106.94), controlPoint1: p(19.65, 108.16), controlPoint2: p(18.79, 107.57))
    path.line(to: p(39.69, 69.79))
    path.curve(to: p(39.03, 68.93), controlPoint1: p(39.94, 69.34), controlPoint2: p(39.53, 68.81))
    path.line(to: p(1.62, 77.95))
    path.curve(to: p(1.21, 76.85), controlPoint1: p(0.94, 78.11), controlPoint2: p(0.59, 77.16))
    path.line(to: p(34.71, 59.89))
    path.curve(to: p(34.67, 58.82), controlPoint1: p(35.16, 59.66), controlPoint2: p(35.14, 59.01))
    path.line(to: p(1.11, 44.81))
    path.curve(to: p(1.45, 43.68), controlPoint1: p(0.45, 44.54), controlPoint2: p(0.75, 43.55))
    path.line(to: p(38.04, 50.92))
    path.curve(to: p(38.66, 50.04), controlPoint1: p(38.54, 51.02), controlPoint2: p(38.92, 50.48))
    path.line(to: p(18.98, 16.78))
    path.curve(to: p(19.92, 16.07), controlPoint1: p(18.62, 16.17), controlPoint2: p(19.43, 15.56))
    path.line(to: p(46.43, 43.84))
    path.curve(to: p(47.45, 43.48), controlPoint1: p(46.78, 44.21), controlPoint2: p(47.41, 43.99))
    path.line(to: p(50.41, 5.6))
    path.curve(to: p(51.59, 5.57), controlPoint1: p(50.47, 4.89), controlPoint2: p(51.49, 4.86))
    path.line(to: p(56.66, 43.21))
    path.curve(to: p(57.7, 43.51), controlPoint1: p(56.73, 43.72), controlPoint2: p(57.37, 43.91))
    path.close()

    NSColor.black.setFill()  // template image なので fill は無視される (auto invert)
    path.fill()
  }
}
