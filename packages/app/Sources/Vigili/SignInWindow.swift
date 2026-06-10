import AppKit
import SwiftUI

/// Sign in with Apple を独立ウィンドウで起動する。
///
/// popover 内からシステムシート (ASAuthorizationController) を呈示すると
/// MenuBarExtra がフォーカスを失って閉じてしまうため、
/// SessionsWindow / OnboardingWindow と同じく独立 NSWindow を使う。
@MainActor
enum SignInWindow {
  private static var current: NSWindow?

  static func show(coordinator: AppCoordinator) {
    if let existing = current, existing.isVisible {
      existing.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
      return
    }

    let root = SignInView(onClose: { Self.close() })
      .environmentObject(coordinator)

    let hosting = NSHostingController(rootView: root)
    let window = NSWindow(contentViewController: hosting)
    window.title = "Vigili — Sign In"
    window.styleMask = [.titled, .closable]
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    window.setContentSize(NSSize(width: 400, height: 340))
    window.center()
    window.isReleasedWhenClosed = false
    window.backgroundColor = NSColor(Theme.bg)

    current = window
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  static func close() {
    current?.close()
    current = nil
  }
}

// MARK: - SignInView

private struct SignInView: View {
  @EnvironmentObject private var coordinator: AppCoordinator
  let onClose: () -> Void

  @State private var status: Status = .idle

  /// 既にサインイン済み (relay 設定済み) かどうか。開いた時点の状態を出す。
  private var alreadySignedIn: Bool { coordinator.relayConfigured }

  enum Status {
    case idle
    case loading
    case success(String) // account email or "完了"
    case error(String)
  }

  var body: some View {
    ZStack {
      Theme.bg.ignoresSafeArea()

      VStack(spacing: 0) {
        // ── ヘッダー ────────────────────────────────────────
        HStack {
          FlowerLogo(color: Theme.accent, size: 20)
          Text("Vigili")
            .font(.display(18, weight: .semibold))
            .foregroundStyle(Theme.fg)
          Spacer()
          Button { onClose() } label: {
            Image(systemName: "xmark")
              .font(.system(size: 11, weight: .medium))
              .foregroundStyle(Theme.fgDim)
          }
          .buttonStyle(.plain)
        }
        .padding(.horizontal, 28)
        .padding(.top, 28)
        .padding(.bottom, 20)

        Rectangle().fill(Theme.border).frame(height: 1).padding(.horizontal, -28)

        // ── 本文 ────────────────────────────────────────────
        VStack(spacing: 24) {
          VStack(spacing: 8) {
            if alreadySignedIn {
              Image(systemName: "checkmark.icloud.fill")
                .font(.system(size: 26))
                .foregroundStyle(Theme.green)
                .padding(.bottom, 2)
              Text("サインイン済み")
                .font(.display(15, weight: .semibold))
                .foregroundStyle(Theme.fg)
              Text("この Mac は Apple アカウントにリンクされ、relay に接続済みです。同じ Apple ID で iPhone にサインインすればペアリング完了。再サインインも下のボタンから可能です。")
                .font(.mono(11))
                .foregroundStyle(Theme.fgDim)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
            } else {
              Text("スマホで承認するには")
                .font(.display(15, weight: .semibold))
                .foregroundStyle(Theme.fg)
              Text("Sign in with Apple で、この Mac と iPhone を同じアカウントにリンクします。QR もターミナルも不要です。")
                .font(.mono(11))
                .foregroundStyle(Theme.fgDim)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
            }
          }
          .padding(.top, 28)

          // ── ステータス表示 ─────────────────────────────────
          switch status {
          case .idle:
            EmptyView()
          case .loading:
            HStack(spacing: 8) {
              ProgressView().controlSize(.small)
              Text("サインイン中…")
                .font(.mono(11))
                .foregroundStyle(Theme.fgDim)
            }
          case .success(let msg):
            HStack(spacing: 6) {
              Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Theme.green)
              Text(msg)
                .font(.mono(11))
                .foregroundStyle(Theme.fg)
            }
          case .error(let msg):
            HStack(spacing: 6) {
              Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.red)
              Text(msg)
                .font(.mono(11))
                .foregroundStyle(Theme.red)
                .multilineTextAlignment(.leading)
            }
            .padding(10)
            .background(
              RoundedRectangle(cornerRadius: 8)
                .fill(Theme.red.opacity(0.08))
                .overlay(RoundedRectangle(cornerRadius: 8)
                  .stroke(Theme.red.opacity(0.3), lineWidth: 0.5))
            )
          }

          // ── アクションボタン ──────────────────────────────
          if alreadySignedIn {
            // ログアウト
            Button {
              Task { await signOut() }
            } label: {
              HStack(spacing: 8) {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                  .font(.system(size: 13, weight: .medium))
                Text("ログアウト")
                  .font(.system(size: 14, weight: .semibold))
              }
              .foregroundStyle(Theme.red)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 12)
              .background(
                RoundedRectangle(cornerRadius: 10)
                  .stroke(Theme.red.opacity(0.4), lineWidth: 1),
              )
            }
            .buttonStyle(.plain)
            .disabled(isLoading)
          } else {
            // Sign in with Apple
            Button {
              Task { await signIn() }
            } label: {
              HStack(spacing: 8) {
                Image(systemName: "applelogo")
                  .font(.system(size: 14, weight: .medium))
                Text("Sign in with Apple")
                  .font(.system(size: 14, weight: .semibold))
              }
              .foregroundStyle(.white)
              .frame(maxWidth: .infinity)
              .padding(.vertical, 12)
              .background(
                RoundedRectangle(cornerRadius: 10)
                  .fill(Color.black),
              )
            }
            .buttonStyle(.plain)
            .disabled(isLoading)
          }

          // ── 補足 ─────────────────────────────────────────
          Text(
            alreadySignedIn
              ? "ログアウトすると relay から切断されます。LAN (同じ Wi-Fi) での承認は引き続き使えます。"
              : "すでに QR でペアリング済みの iPhone は引き続き使えます。",
          )
          .font(.mono(10))
          .foregroundStyle(Theme.fgDim)
          .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 28)
        .padding(.bottom, 28)
      }
    }
    .preferredColorScheme(.dark)
  }

  private var isLoading: Bool {
    if case .loading = status { return true }
    return false
  }

  @MainActor
  private func signIn() async {
    status = .loading
    do {
      try await coordinator.performSignInWithApple()
      status = .success("relay に接続しました ✓")
      // 2 秒後に自動クローズ
      try? await Task.sleep(nanoseconds: 2_000_000_000)
      onClose()
    } catch {
      status = .error(error.localizedDescription)
    }
  }

  @MainActor
  private func signOut() async {
    status = .loading
    do {
      try await coordinator.signOut()
      status = .success("ログアウトしました")
      try? await Task.sleep(nanoseconds: 1_500_000_000)
      onClose()
    } catch {
      status = .error(error.localizedDescription)
    }
  }
}
