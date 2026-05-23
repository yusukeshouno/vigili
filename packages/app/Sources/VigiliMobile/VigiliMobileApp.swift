import SwiftUI

/// Sentinel iOS のエントリポイント。
///
/// 起動時の流れ:
///  - MobileSettings に daemon URL + token が保存されていれば → QueueView
///  - 未設定なら → SetupView (URL + token 入力)
///
/// Live Activity は Phase 13-C で追加予定。今は通常の Queue / Detail / Settings のみ。
@main
struct VigiliMobileApp: App {
  @StateObject private var coordinator = MobileAppCoordinator()

  init() {
    FontRegistration.registerBundledFonts()
  }

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(coordinator)
        .preferredColorScheme(.dark)
        // sentinel://setup?u=<host>&t=<token> を受け取って即接続。
        // Mac で `sentinel-cli setup-link` から生成したリンクを
        // AirDrop / iMessage で iPhone に送ってタップする想定。
        .onOpenURL { url in
          coordinator.handleSetupURL(url)
        }
    }
  }
}

/// 設定済みか未設定かで Queue / Setup を出し分ける。
struct RootView: View {
  @EnvironmentObject private var coordinator: MobileAppCoordinator

  var body: some View {
    if coordinator.isConfigured {
      MobileQueueView()
    } else {
      MobileSetupView()
    }
  }
}
