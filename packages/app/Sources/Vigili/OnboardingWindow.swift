import AppKit
import SwiftUI

/// ウィザードを popover ではなく独立した NSWindow として開くためのヘルパ。
///
/// 背景:
///  MenuBarExtra の popover から `.sheet` を出すと、クリックが popover に
///  奪われたり、popover が消えるタイミングで sheet も巻き込まれて消えたりする。
///  独立 window にすればフォーカスもクリックも問題なく扱える。
@MainActor
enum OnboardingWindow {
  /// 表示中のウィンドウ参照（多重表示防止）。
  private static var current: NSWindow?

  static func show(coordinator: AppCoordinator, onClose: ((_ wrote: Bool) -> Void)? = nil) {
    if let existing = current, existing.isVisible {
      existing.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      return
    }

    let root = OnboardingWizardView { wrote in
      onClose?(wrote)
      Self.close()
    }
    .environmentObject(coordinator)

    let hosting = NSHostingController(rootView: root)
    let window = NSWindow(contentViewController: hosting)
    window.title = "Vigili — ルール設定"
    window.styleMask = [.titled, .closable]
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.setContentSize(NSSize(width: 560, height: 620))
    window.center()
    window.isReleasedWhenClosed = false
    window.level = .floating  // 他のアプリより前に出す

    current = window
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  static func close() {
    current?.close()
    current = nil
  }
}
