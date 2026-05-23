import AppKit

/// MenuBarExtra の label に渡す用の 8 突点星アイコン (NSImage)。
///
/// SwiftUI の `Canvas` / `Path` を MenuBarExtra label に直接入れると
/// AppKit 側で正しくサイズ・描画されず黒丸になることがある。
/// `NSImage(size:flipped:drawingHandler:)` で AppKit ネイティブに描き、
/// `isTemplate = true` でメニューバーの明暗に追従させる。
///
/// 形状は `Sources/Shared/StarPath.swift` と同じ Adobe Illustrator v2 path。
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
  /// 原典 viewBox 0 0 105 118.52、bbox 中心 (52.5, 59.26)。
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
    path.move(to: p(60.75, 45.25))
    path.line(to: p(86.35, 25.94))
    path.curve(to: p(87.2, 26.77), controlPoint1: p(86.9, 25.52), controlPoint2: p(87.61, 26.21))
    path.line(to: p(68.43, 52.77))
    path.curve(to: p(68.84, 53.72), controlPoint1: p(68.16, 53.14), controlPoint2: p(68.39, 53.66))
    path.line(to: p(101, 58.17))
    path.curve(to: p(101.01, 59.36), controlPoint1: p(101.69, 58.26), controlPoint2: p(101.7, 59.25))
    path.line(to: p(68.91, 64.48))
    path.curve(to: p(68.51, 65.42), controlPoint1: p(68.47, 64.55), controlPoint2: p(68.26, 65.06))
    path.line(to: p(83.51, 86.77))
    path.curve(to: p(82.68, 87.62), controlPoint1: p(83.89, 87.32), controlPoint2: p(83.24, 87.99))
    path.line(to: p(61.03, 73.07))
    path.curve(to: p(60.1, 73.49), controlPoint1: p(60.66, 72.82), controlPoint2: p(60.16, 73.05))
    path.line(to: p(55.73, 105.77))
    path.curve(to: p(54.54, 105.79), controlPoint1: p(55.64, 106.46), controlPoint2: p(54.65, 106.47))
    path.line(to: p(49.34, 73.63))
    path.curve(to: p(48.38, 73.24), controlPoint1: p(49.27, 73.18), controlPoint2: p(48.74, 72.97))
    path.line(to: p(22.78, 92.55))
    path.curve(to: p(21.93, 91.72), controlPoint1: p(22.23, 92.97), controlPoint2: p(21.52, 92.28))
    path.line(to: p(40.69, 65.73))
    path.curve(to: p(40.28, 64.78), controlPoint1: p(40.96, 65.36), controlPoint2: p(40.73, 64.84))
    path.line(to: p(4.48, 60.32))
    path.curve(to: p(4.47, 59.12), controlPoint1: p(3.78, 60.23), controlPoint2: p(3.77, 59.22))
    path.line(to: p(40.2, 53.99))
    path.curve(to: p(40.61, 53.05), controlPoint1: p(40.65, 53.93), controlPoint2: p(40.87, 53.41))
    path.line(to: p(25.62, 31.72))
    path.curve(to: p(26.45, 30.87), controlPoint1: p(25.24, 31.17), controlPoint2: p(25.89, 30.5))
    path.line(to: p(48.1, 45.41))
    path.curve(to: p(49.03, 44.99), controlPoint1: p(48.47, 45.66), controlPoint2: p(48.98, 45.43))
    path.line(to: p(53.4, 11))
    path.curve(to: p(54.59, 10.99), controlPoint1: p(53.49, 10.31), controlPoint2: p(54.49, 10.3))
    path.line(to: p(59.8, 44.85))
    path.curve(to: p(60.76, 45.24), controlPoint1: p(59.87, 45.3), controlPoint2: p(60.39, 45.51))
    path.close()

    NSColor.black.setFill()  // template image なので fill は無視される (auto invert)
    path.fill()
  }
}
