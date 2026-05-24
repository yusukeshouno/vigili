import SwiftUI

/// 初回起動時のオンボーディング (Mac の WelcomeView と対称、iOS 側)。
///
/// Mac 側は「Vigili がインストール済み、QR を出すから読み取って」というスタンスだが、
/// iOS 側は scanner なので「Mac で QR を出してね」と誘導する。
///
/// 流れ:
///   1. 3 行で何のアプリかを伝える
///   2. Scan QR (大きい primary CTA) → MobileSetupView の scanner に直行
///   3. Skip (secondary) → MobileSetupView の手動入力に行く
struct MobileWelcomeView: View {
  @EnvironmentObject private var coordinator: MobileAppCoordinator

  /// `true` に立つと親 (RootView) が MobileSetupView をスキャナ自動 open で表示する。
  @Binding var startWithScanner: Bool

  var body: some View {
    ZStack {
      Theme.bg.ignoresSafeArea()
      VStack(alignment: .leading, spacing: 0) {
        Spacer(minLength: 8)

        // header
        HStack(spacing: 12) {
          FlowerLogo(color: Theme.accent, size: 28)
          Text("Vigili")
            .font(.display(22, weight: .semibold))
            .foregroundStyle(Theme.fg)
        }
        .padding(.bottom, 32)

        // title
        Text("Approve\nClaude Code\nfrom your phone.")
          .font(.display(34, weight: .semibold))
          .foregroundStyle(Theme.fg)
          .lineSpacing(2)
          .multilineTextAlignment(.leading)
          .padding(.bottom, 28)

        // bullets
        VStack(alignment: .leading, spacing: 14) {
          bullet(
            "Mac 側で Vigili daemon を動かしておく。menu bar のアイコンを開くと最初に QR が出ます。",
          )
          bullet(
            "下の Scan ボタンでカメラを開いてその QR を読み取ると、同じネットワークなら即接続。",
          )
          bullet(
            "外出先からも承認したければ、Mac で `vigili-cli pair` を一度実行して、出てきた vigili://pair... QR も同じ scanner で取り込んで。",
          )
        }
        .padding(.bottom, 28)

        Spacer()

        // CTA
        VStack(spacing: 12) {
          PillButton(
            label: "Scan setup QR",
            icon: "qrcode.viewfinder",
            style: .primary
          ) {
            startWithScanner = true
            coordinator.dismissWelcome()
          }
          PillButton(
            label: "Skip — enter manually",
            icon: "arrow.right",
            style: .ghost
          ) {
            startWithScanner = false
            coordinator.dismissWelcome()
          }
        }
        .padding(.bottom, 32)
      }
      .padding(.horizontal, 22)
    }
    .preferredColorScheme(.dark)
  }

  private func bullet(_ text: String) -> some View {
    HStack(alignment: .top, spacing: 10) {
      Text("·")
        .font(.system(size: 18, weight: .bold))
        .foregroundStyle(Theme.accent)
      Text(text)
        .font(.system(size: 14))
        .foregroundStyle(Theme.fgMid)
        .lineSpacing(3)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}
