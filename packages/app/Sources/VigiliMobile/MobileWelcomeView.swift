import SwiftUI

struct MobileWelcomeView: View {
  @EnvironmentObject private var coordinator: MobileAppCoordinator
  @Binding var startWithScanner: Bool
  @State private var copiedCmd: String? = nil
  /// ロゴ登場アニメーションのトリガー
  @State private var logoAppeared = false
  /// ステップ行スタッガード用
  @State private var stepsAppeared = false

  var body: some View {
    ZStack {
      Theme.bg.ignoresSafeArea()
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          // ── header ──────────────────────────────────────────────────
          HStack(spacing: 12) {
            FlowerLogo(color: Theme.accent, size: 22)
              // ロゴが画面に現れるとき: 0 → 1.2 → 1.0 でバウンス + -90°から回転
              .scaleEffect(logoAppeared ? 1.0 : 0.2)
              .rotationEffect(.degrees(logoAppeared ? 0 : -120))
              .animation(
                .spring(response: 0.52, dampingFraction: 0.52),
                value: logoAppeared
              )
            Text("Vigili")
              .font(.display(22, weight: .semibold))
              .foregroundStyle(Theme.fg)
              .opacity(logoAppeared ? 1 : 0)
              .offset(x: logoAppeared ? 0 : -12)
              .animation(
                .spring(response: 0.4, dampingFraction: 0.7).delay(0.08),
                value: logoAppeared
              )
          }
          .padding(.bottom, 24)

          Text("Approve\nClaude Code\nfrom your phone.")
            .font(.display(32, weight: .semibold))
            .foregroundStyle(Theme.fg)
            .lineSpacing(2)
            .multilineTextAlignment(.leading)
            .opacity(logoAppeared ? 1 : 0)
            .offset(y: logoAppeared ? 0 : 14)
            .animation(
              .spring(response: 0.45, dampingFraction: 0.68).delay(0.14),
              value: logoAppeared
            )
            .padding(.bottom, 36)

          // ── setup steps: stagger each row ───────────────────────────
          VStack(alignment: .leading, spacing: 22) {
            stepRow(index: "01", title: "Mac でインストール") {
              CopyRow(cmd: "npm install -g @vigili/daemon @vigili/gate",
                      copiedCmd: $copiedCmd, onCopy: copyToClipboard)
            }
            .opacity(stepsAppeared ? 1 : 0)
            .offset(y: stepsAppeared ? 0 : 20)
            .animation(.spring(response: 0.4, dampingFraction: 0.68).delay(0.18), value: stepsAppeared)

            stepRow(index: "02", title: "daemon を起動 + hook を登録") {
              CopyRow(cmd: "vigili-daemon start",
                      copiedCmd: $copiedCmd, onCopy: copyToClipboard)
              CopyRow(cmd: "vigili-gate --install-hook",
                      copiedCmd: $copiedCmd, onCopy: copyToClipboard)
            }
            .opacity(stepsAppeared ? 1 : 0)
            .offset(y: stepsAppeared ? 0 : 20)
            .animation(.spring(response: 0.4, dampingFraction: 0.68).delay(0.26), value: stepsAppeared)

            stepRow(index: "03", title: "QR をターミナルまたは menu bar で表示") {
              CopyRow(cmd: "vigili-daemon qr",
                      copiedCmd: $copiedCmd, onCopy: copyToClipboard)
            }
            .opacity(stepsAppeared ? 1 : 0)
            .offset(y: stepsAppeared ? 0 : 20)
            .animation(.spring(response: 0.4, dampingFraction: 0.68).delay(0.34), value: stepsAppeared)

            stepRow(index: "04", title: "ここでスキャン") {
              EmptyView()
            }
            .opacity(stepsAppeared ? 1 : 0)
            .offset(y: stepsAppeared ? 0 : 20)
            .animation(.spring(response: 0.4, dampingFraction: 0.68).delay(0.42), value: stepsAppeared)
          }
          .padding(.bottom, 32)

          // ── CTA ─────────────────────────────────────────────────────
          VStack(spacing: 12) {
            // 主軸: Sign in with Apple — ターミナル/QR 不要でアカウント連携。
            PillButton(
              label: coordinator.isSigningIn ? "サインイン中…" : "Sign in with Apple",
              icon: "apple.logo",
              style: .primary
            ) {
              Task { await coordinator.signInWithApple() }
            }
            .disabled(coordinator.isSigningIn)

            if let err = coordinator.signInError {
              Text(err)
                .font(.system(size: 12))
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            // フォールバック: QR スキャン / 手動入力 (上の Mac 手順を使う既存経路)。
            PillButton(
              label: "QR でセットアップ",
              icon: "qrcode.viewfinder",
              style: .ghost
            ) {
              startWithScanner = true
              coordinator.dismissWelcome()
            }
            PillButton(
              label: "手動で入力",
              icon: "arrow.right",
              style: .ghost
            ) {
              startWithScanner = false
              coordinator.dismissWelcome()
            }
          }
          .opacity(stepsAppeared ? 1 : 0)
          .offset(y: stepsAppeared ? 0 : 16)
          .animation(.spring(response: 0.4, dampingFraction: 0.7).delay(0.52), value: stepsAppeared)
          .padding(.bottom, 44)
        }
        .padding(.horizontal, 22)
        .padding(.top, 20)
      }
    }
    .preferredColorScheme(.dark)
    .onAppear {
      logoAppeared = true
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
        stepsAppeared = true
      }
    }
  }

  private func copyToClipboard(_ cmd: String) {
    UIPasteboard.general.string = cmd
    copiedCmd = cmd
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
      if copiedCmd == cmd { copiedCmd = nil }
    }
  }

  @ViewBuilder
  private func stepRow<Content: View>(
    index: String,
    title: String,
    @ViewBuilder content: () -> Content
  ) -> some View {
    HStack(alignment: .top, spacing: 14) {
      Text(index)
        .font(.mono(11))
        .foregroundStyle(Theme.fgDim)
        .frame(width: 24, alignment: .trailing)
        .padding(.top, 3)
      VStack(alignment: .leading, spacing: 8) {
        Text(title)
          .font(.system(size: 14, weight: .medium))
          .foregroundStyle(Theme.fg)
        content()
      }
    }
  }
}

// ── copy-able command row ─────────────────────────────────────────────

private struct CopyRow: View {
  let cmd: String
  @Binding var copiedCmd: String?
  let onCopy: (String) -> Void

  private var isCopied: Bool { copiedCmd == cmd }

  var body: some View {
    HStack(spacing: 10) {
      Text(cmd)
        .font(.mono(12))
        .foregroundStyle(Theme.fg)
        .lineLimit(1)
        .minimumScaleFactor(0.72)
        .frame(maxWidth: .infinity, alignment: .leading)

      Button { onCopy(cmd) } label: {
        Group {
          if isCopied {
            Image(systemName: "checkmark")
              .foregroundStyle(Theme.accent)
          } else {
            Image(systemName: "doc.on.doc")
              .foregroundStyle(Theme.fgMid)
          }
        }
        .font(.system(size: 13))
        .frame(width: 28, height: 28)
        .animation(.easeInOut(duration: 0.18), value: isCopied)
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .background(Theme.bgRise)
    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .stroke(Theme.border, lineWidth: 1)
    )
  }
}
