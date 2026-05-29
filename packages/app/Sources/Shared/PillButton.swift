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
/// スプリングバウンス (派手版): 押下で 0.82 まで沈み、リリース時に大きくオーバーシュートして 1.0 へ。
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
          .font(.system(size: iconSize, weight: .semibold))
        Text(label)
          .font(.display(labelSize, weight: .medium))
      }
      .foregroundStyle(foreground)
      .frame(maxWidth: .infinity)
      .padding(.vertical, verticalPadding)
      .padding(.horizontal, 20)
      .background(
        Capsule().fill(background)
      )
      .overlay(
        Capsule().stroke(stroke, lineWidth: 1.5)
      )
      // 押下: 0.82 まで深く縮む。リリース: 低 damping の spring で大きくオーバーシュートしながら 1.0 へ
      .scaleEffect(pressed ? 0.82 : 1.0)
      .animation(
        pressed
          ? .easeIn(duration: 0.05)
          : .spring(response: 0.34, dampingFraction: 0.38, blendDuration: 0),
        value: pressed
      )
      // shadow (primary only) — 押下で潰れ、リリースで大きく浮き上がる
      .shadow(
        color: style == .primary ? Theme.accent.opacity(pressed ? 0.2 : 0.45) : .clear,
        radius: pressed ? 1 : 13,
        y: pressed ? 0 : 6
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

  // タッチが主操作の iOS では一回り大きく取り、HIG の 44pt 以上を満たす。
  // Mac (click) は従来サイズのまま。
  private var verticalPadding: CGFloat {
    #if os(iOS)
    return 17
    #else
    return 13
    #endif
  }

  private var labelSize: CGFloat {
    #if os(iOS)
    return 16
    #else
    return 14
    #endif
  }

  private var iconSize: CGFloat {
    #if os(iOS)
    return 14
    #else
    return 12
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
