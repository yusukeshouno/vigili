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
  // APNs 登録 + リモート通知ハンドリングのために UIApplicationDelegate を差し込む。
  @UIApplicationDelegateAdaptor(MobileAppDelegate.self) private var appDelegate
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

/// Welcome → Setup → Queue の 3 段。
/// - 初回起動 (vigili.welcomed が立っていない) → MobileWelcomeView
/// - 未設定 → MobileSetupView (Welcome の CTA 経由なら scanner 自動 open)
/// - 設定済 → MobileQueueView
struct RootView: View {
  @EnvironmentObject private var coordinator: MobileAppCoordinator
  @State private var setupShouldOpenScanner: Bool = false

  var body: some View {
    if coordinator.showWelcome {
      MobileWelcomeView(startWithScanner: $setupShouldOpenScanner)
    } else if coordinator.isConfigured {
      MobileQueueView()
    } else {
      MobileSetupView(autoOpenScanner: setupShouldOpenScanner)
    }
  }
}
