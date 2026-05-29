import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// PWA の `.a-btn-primary` / `.a-btn-ghost` と揃えたピル型ボタン。
///
/// - primary: coral 塗りつぶし、白文字 (Allow 用)
/// - ghost:   transparent、border (Deny 用)
///
/// スプリングバウンス: 押下で 0.88 → リリース時に 1.06 → 1.0 のオーバーシュート。
struct PillButton: View {
  enum Style {
    case primary
    case ghost
  }

  let label: String
  let icon: String
  let style: Style
  let action: () -> Void

  @State private var pressed = false
  @State private var bouncing = false

  var body: some View {
    Button(action: {
      triggerHaptic()
      action()
    }) {
      HStack(spacing: 8) {
        Image(systemName: icon)
          .font(.system(size: 12, weight: .semibold))
        Text(label)
          .font(.display(14, weight: .medium))
      }
      .foregroundStyle(foreground)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 13)
      .padding(.horizontal, 20)
      .background(
        Capsule().fill(background)
      )
      .overlay(
        Capsule().stroke(stroke, lineWidth: 1.5)
      )
      // 押下: 0.88 まで縮む。リリース: spring でオーバーシュートしながら 1.0 に戻る
      .scaleEffect(pressed ? 0.88 : 1.0)
      .animation(
        pressed
          ? .easeIn(duration: 0.06)
          : .spring(response: 0.25, dampingFraction: 0.44, blendDuration: 0),
        value: pressed
      )
      // shadow (primary only)
      .shadow(
        color: style == .primary ? Theme.accent.opacity(0.35) : .clear,
        radius: pressed ? 2 : 8,
        y: pressed ? 1 : 4
      )
    }
    .buttonStyle(.plain)
    .onLongPressGesture(
      minimumDuration: 0,
      maximumDistance: .infinity,
      pressing: { p in pressed = p },
      perform: {}
    )
  }

  private func triggerHaptic() {
    #if canImport(UIKit)
    let style: UIImpactFeedbackGenerator.FeedbackStyle = self.style == .primary ? .medium : .light
    let gen = UIImpactFeedbackGenerator(style: style)
    gen.impactOccurred()
    #elseif canImport(AppKit)
    NSHapticFeedbackManager.defaultPerformer.perform(
      .alignment,
      performanceTime: .default
    )
    #endif
  }

  private var foreground: Color {
    switch style {
    case .primary: return .white
    case .ghost: return Theme.fgMid
    }
  }

  private var background: Color {
    switch style {
    case .primary: return Theme.accent
    case .ghost: return .clear
    }
  }

  private var stroke: Color {
    switch style {
    case .primary: return .clear
    case .ghost: return Theme.borderStrong
    }
  }
}
