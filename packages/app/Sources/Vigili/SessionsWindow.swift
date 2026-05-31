import AppKit
import SwiftUI

/// ホスト型セッション (vigili run) の transcript + 回答 UI を独立ウィンドウで開く。
///
/// popover は縦が狭く、また `.sheet` はフォーカスを奪われて消えるため、
/// OnboardingWindow と同じく独立 NSWindow にする。
@MainActor
enum SessionsWindow {
  private static var current: NSWindow?

  static func show(coordinator: AppCoordinator) {
    if let existing = current, existing.isVisible {
      existing.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      return
    }

    let root = SessionsView(onClose: { Self.close() })
      .environmentObject(coordinator)

    let hosting = NSHostingController(rootView: root)
    let window = NSWindow(contentViewController: hosting)
    window.title = "Vigili — Sessions"
    window.styleMask = [.titled, .closable, .resizable]
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.setContentSize(NSSize(width: 720, height: 680))
    window.center()
    window.isReleasedWhenClosed = false

    current = window
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  static func close() {
    current?.close()
    current = nil
  }
}
