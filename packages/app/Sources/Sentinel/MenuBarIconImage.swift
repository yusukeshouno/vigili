import AppKit

/// MenuBarExtra の label に渡す用の 4 弁花アイコン (NSImage)。
///
/// SwiftUI の `Canvas` / `Path` を MenuBarExtra label に直接入れると
/// AppKit 側で正しくサイズ・描画されず黒丸になることがある。
/// `NSImage(size:flipped:drawingHandler:)` で AppKit ネイティブに描き、
/// `isTemplate = true` でメニューバーの明暗に追従させる。
enum MenuBarIconImage {
  /// 一度生成したものをキャッシュ (サイズ違いは現状無いので 1 つで OK)。
  /// 他アプリのメニューバーアイコンと揃えるため 22pt。
  static let shared: NSImage = make(size: 22)

  static func make(size: CGFloat) -> NSImage {
    let img = NSImage(
      size: NSSize(width: size, height: size),
      flipped: false
    ) { rect in
      // 内部スケール: 花の最遠点 (y=4 → 中心から 12 unit) が image 境界を
      // 越えると menubar で上下クリップされる。
      // 計算: 12 * (image/32) * petalScale <= image/2 → petalScale <= 32/(2*12) = 1.333
      // 余白を 2pt 確保するため 1.1 を採用。
      let petalScale: CGFloat = 1.1
      let baseScale = rect.width / 32.0
      let scale = baseScale * petalScale
      let cx = rect.midX
      let cy = rect.midY

      // 4 弁を 90 度ずつ回転して描く。PWA の Bezier path 同形:
      //   M 16 14 C 13 11 13 7 16 4 C 19 7 19 11 16 14 Z
      for rotation in stride(from: 0.0, to: 360.0, by: 90.0) {
        let transform = NSAffineTransform()
        transform.translateX(by: cx, yBy: cy)
        transform.rotate(byDegrees: CGFloat(rotation))
        transform.scaleX(by: scale, yBy: scale)
        transform.translateX(by: -16, yBy: -16)

        let petal = NSBezierPath()
        petal.move(to: NSPoint(x: 16, y: 14))
        petal.curve(
          to: NSPoint(x: 16, y: 4),
          controlPoint1: NSPoint(x: 13, y: 11),
          controlPoint2: NSPoint(x: 13, y: 7)
        )
        petal.curve(
          to: NSPoint(x: 16, y: 14),
          controlPoint1: NSPoint(x: 19, y: 7),
          controlPoint2: NSPoint(x: 19, y: 11)
        )
        petal.close()
        transform.transform(petal).fill()
      }

      // 中央の小さい円。scale には petalScale を既に掛けているので二重掛けしない。
      let dotR: CGFloat = 1.6 * scale
      let dot = NSBezierPath(ovalIn: NSRect(
        x: cx - dotR, y: cy - dotR,
        width: dotR * 2, height: dotR * 2
      ))
      NSColor.black.setFill()
      dot.fill()

      return true
    }
    // template = メニューバーで自動的に white に反転、ホバー時のハイライトも自動
    img.isTemplate = true
    return img
  }
}
