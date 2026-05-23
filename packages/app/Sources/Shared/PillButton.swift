import SwiftUI

/// PWA の `.a-btn-primary` / `.a-btn-ghost` と揃えたピル型ボタン。
///
/// - primary: coral 塗りつぶし、白文字 (Allow 用)
/// - ghost:   transparent、border (Deny 用)
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

  var body: some View {
    Button(action: action) {
      HStack(spacing: 7) {
        Image(systemName: icon)
          .font(.system(size: 11, weight: .semibold))
        Text(label)
          .font(.display(13, weight: .medium))
      }
      .foregroundStyle(foreground)
      .frame(maxWidth: .infinity)
      .padding(.vertical, 11)
      .padding(.horizontal, 18)
      .background(
        Capsule().fill(background)
      )
      .overlay(
        Capsule().stroke(stroke, lineWidth: 1)
      )
      .scaleEffect(pressed ? 0.985 : 1.0)
      .animation(.spring(response: 0.18, dampingFraction: 0.7), value: pressed)
    }
    .buttonStyle(.plain)
    .onLongPressGesture(
      minimumDuration: 0,
      maximumDistance: .infinity,
      pressing: { p in pressed = p },
      perform: {}
    )
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
    case .primary: return Theme.accent
    case .ghost: return Theme.borderStrong
    }
  }
}
