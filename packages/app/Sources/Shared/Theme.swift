import SwiftUI

/// PWA の Claude Stack デザイン (packages/pwa/src/app/globals.css) と揃えたカラー / 型ヘルパ。
///
/// パレットはすべて warm dark + Claude coral。
/// 文字色は cream rgba 系で、SwiftUI の .secondary/.tertiary は使わずに明示する。
enum Theme {
  // MARK: - 背景

  static let bg = Color(hex: "#262624")
  static let bgRise = Color(hex: "#2d2b29")
  static let bgRise2 = Color(hex: "#34322f")
  static let bgCode = Color(hex: "#1f1e1d")

  // MARK: - 文字 (warm cream に α)

  static let fg = Color(white: 0.967, opacity: 0.95)     // = rgba(250,247,242,0.95)
  static let fgMid = Color(white: 0.967, opacity: 0.62)
  static let fgDim = Color(white: 0.967, opacity: 0.40)
  static let fgFaint = Color(white: 0.967, opacity: 0.18)

  // MARK: - ボーダー (warm cream に小さい α)

  static let border = Color(white: 0.967, opacity: 0.08)
  static let borderStrong = Color(white: 0.967, opacity: 0.14)

  // MARK: - アクセント (Claude coral — 8 突点星と同じ赤橙)

  static let accent = Color(hex: "#c96442")
  static let accentSoft = Color(hex: "#d97757")
  static let accentDim = Color(hex: "#8a4329")

  // MARK: - セマンティック (desaturated)

  static let green = Color(hex: "#7bae89")
  static let greenSoft = Color(hex: "#a6d3b0")
  static let red = Color(hex: "#d6766c")
  static let redSoft = Color(hex: "#e89a92")
  static let amber = Color(hex: "#d4936d")
}

// MARK: - フォントヘルパ
//
// Bricolage Grotesque と JetBrains Mono は Resources/Fonts/ に bundle 済み。
// Info.plist の `ATSApplicationFontsPath` で自動登録されるので
// .font(.custom(...)) でそのまま使える。

extension Font {
  /// 見出し / UI 用 (Bricolage Grotesque)
  static func display(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
    .custom("Bricolage Grotesque", size: size).weight(weight)
  }

  /// 等幅 (JetBrains Mono) — コマンドプレビュー / ID 表示など
  static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
    .custom("JetBrains Mono", size: size).weight(weight)
  }
}

// MARK: - Color(hex:) ヘルパ

extension Color {
  /// `#RRGGBB` または `#RRGGBBAA` 文字列から Color を作る。
  /// 不正な値は黒にフォールバック (黙って失敗、UI に出ないことを優先)。
  init(hex: String) {
    let s = hex.trimmingCharacters(in: .alphanumerics.inverted)
    var int: UInt64 = 0
    Scanner(string: s).scanHexInt64(&int)
    let r, g, b, a: Double
    switch s.count {
    case 6:
      r = Double((int >> 16) & 0xFF) / 255.0
      g = Double((int >> 8) & 0xFF) / 255.0
      b = Double(int & 0xFF) / 255.0
      a = 1.0
    case 8:
      r = Double((int >> 24) & 0xFF) / 255.0
      g = Double((int >> 16) & 0xFF) / 255.0
      b = Double((int >> 8) & 0xFF) / 255.0
      a = Double(int & 0xFF) / 255.0
    default:
      r = 0; g = 0; b = 0; a = 1.0
    }
    self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
  }
}
