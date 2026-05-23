import SwiftUI

/// Sentinel.app のエントリポイント。
///
/// 構成:
/// - macOS 13+ の `MenuBarExtra` でメニューバーアイコンを出す
/// - pending > 0 のときはアイコン横に数字バッジを出す (MenuBarExtra の label に Text/Image を組み合わせ)
/// - `.menuBarExtraStyle(.window)` でポップオーバー風の独自 UI
@main
struct SentinelApp: App {
  @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
  @StateObject private var coordinator = AppCoordinator()

  var body: some Scene {
    MenuBarExtra {
      PopoverContentView()
        .environmentObject(coordinator)
        .frame(minWidth: 400, idealWidth: 420, minHeight: 440, idealHeight: 560)
    } label: {
      // pending 0 → アイコンのみ。pending >0 → アイコン + 数字。
      // SwiftUI の MenuBarExtra label は Text/Image を直接組み合わせられる。
      MenuBarLabel(pendingCount: coordinator.pendingCount)
    }
    .menuBarExtraStyle(.window)
  }
}

private struct MenuBarLabel: View {
  let pendingCount: Int

  var body: some View {
    HStack(spacing: 4) {
      // AppKit ネイティブで描いた NSImage (template)。
      // SwiftUI Canvas を渡すと MenuBarExtra で正しく rasterize されないので
      // ここだけ AppKit に降りる。
      Image(nsImage: MenuBarIconImage.shared)
      if pendingCount > 0 {
        Text("\(pendingCount)")
          .font(.system(size: 11, weight: .semibold))
          .monospacedDigit()
      }
    }
  }
}
