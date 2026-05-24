import SwiftUI

/// メニューバーアイコンクリックで出るポップオーバーの中身。
///
/// PWA の Claude Stack デザインに揃えてある:
///  - 背景: `Theme.bg` (#262624)
///  - サーフェス: `Theme.bgRise` (#2d2b29) + warm cream ボーダー
///  - アクセント: `Theme.accent` (#c96442)
///  - 見出し: Bricolage Grotesque、コードは JetBrains Mono
struct PopoverContentView: View {
  @EnvironmentObject private var coordinator: AppCoordinator

  var body: some View {
    if coordinator.showWelcome {
      WelcomeView()
    } else {
      mainContent
    }
  }

  private var mainContent: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      divider
      Spacer(minLength: 14)
      placeholder
      Spacer(minLength: 12)
      if coordinator.pending.isEmpty {
        divider
        footer
        Spacer(minLength: 14)
        MessageComposerView()
      } else {
        actionsBar
        Spacer(minLength: 12)
        MessageComposerView()
        Spacer(minLength: 12)
        divider
        footer
      }
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 16)
    .background(Theme.bg)
    .preferredColorScheme(.dark)
  }

  /// pending がある時、popover 底に固定で出る Allow / Deny。
  /// 必ず一番上のカード (最新の ask) に対して効く。
  /// SwipeStack の "top card のみ操作可" メタファを継承。
  private var actionsBar: some View {
    let topCard = coordinator.pending.sorted(by: { $0.createdAt > $1.createdAt }).first
    return HStack(spacing: 10) {
      PillButton(
        label: "Deny",
        icon: "xmark",
        style: .ghost,
        action: {
          if let id = topCard?.id {
            coordinator.decide(id: id, decision: "deny")
          }
        }
      )
      PillButton(
        label: "Allow",
        icon: "checkmark",
        style: .primary,
        action: {
          if let id = topCard?.id {
            coordinator.decide(id: id, decision: "allow")
          }
        }
      )
    }
    .padding(.vertical, 12)
    .disabled(topCard == nil)
  }

  // MARK: - sections

  private var divider: some View {
    Rectangle()
      .fill(Theme.border)
      .frame(height: 1)
      .padding(.horizontal, -18)  // popover の左右端まで伸ばす
  }

  private var header: some View {
    HStack(spacing: 12) {
      FlowerLogo(
        color: coordinator.pendingCount > 0 ? Theme.accent : Theme.fgMid,
        size: 22
      )
      HStack(spacing: 8) {
        Text("Vigili")
          .font(.display(16, weight: .semibold))
          .foregroundStyle(Theme.fg)
        if coordinator.pendingCount > 0 {
          Text("\(coordinator.pendingCount) PENDING")
            .font(.mono(9, weight: .semibold))
            .tracking(0.12 * 9)
            .foregroundStyle(Theme.accent)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(
              Capsule().stroke(Theme.accent.opacity(0.5), lineWidth: 0.5)
            )
        }
      }
      Spacer()
      // daemon が crashed / stopped の場合だけ目立たない警告を出す
      if case .crashed(_, _) = coordinator.daemonStatus {
        Text("daemon down")
          .font(.mono(9))
          .foregroundStyle(Theme.red)
      } else if case .stopped = coordinator.daemonStatus {
        Text("daemon stopped")
          .font(.mono(9))
          .foregroundStyle(Theme.fgDim)
      }
    }
    .padding(.bottom, 12)
  }

  private var placeholder: some View {
    Group {
      if coordinator.pending.isEmpty {
        emptyState
      } else {
        cardList
      }
    }
    .frame(maxWidth: .infinity)
    .padding(.top, 8)
  }

  private var emptyState: some View {
    StandingWatchView(wsState: coordinator.wsState)
      .padding(.vertical, 24)
  }

  private var cardList: some View {
    // ボタンは popover 底の actionsBar に統一。
    // top card (最新) を強調、それ以下は半透明にして「スタック感」を出す。
    let sorted = coordinator.pending.sorted(by: { $0.createdAt > $1.createdAt })
    return ScrollView {
      VStack(spacing: 12) {
        ForEach(Array(sorted.enumerated()), id: \.element.id) { idx, req in
          ApprovalCard(request: req)
            .opacity(idx == 0 ? 1.0 : 0.55)
            .scaleEffect(idx == 0 ? 1.0 : 0.985)
            .transition(.scale(scale: 0.95).combined(with: .opacity))
        }
      }
      .padding(.vertical, 4)
      .animation(.spring(response: 0.4, dampingFraction: 0.85), value: coordinator.pending.count)
    }
    .frame(maxHeight: 380)
  }

  private var footer: some View {
    HStack(spacing: 6) {
      Button {
        coordinator.daemonController.restart()
      } label: {
        HStack(spacing: 6) {
          Image(systemName: "arrow.clockwise")
            .font(.system(size: 10))
          Text("Restart daemon")
            .font(.mono(10))
        }
        .foregroundStyle(Theme.fgMid)
      }
      .buttonStyle(.plain)

      Spacer()

      Button {
        openLogs()
      } label: {
        Image(systemName: "doc.text")
          .font(.system(size: 12))
          .foregroundStyle(Theme.fgMid)
      }
      .buttonStyle(.plain)
      .help("View daemon log")

      Button {
        NSApp.terminate(nil)
      } label: {
        Image(systemName: "power")
          .font(.system(size: 12))
          .foregroundStyle(Theme.fgMid)
      }
      .buttonStyle(.plain)
      .help("Quit Sentinel")
    }
    .padding(.top, 12)
  }

  // MARK: - helpers

  private func openLogs() {
    // ~/.vigili が存在しなければ旧 ~/.sentinel から開く (移行期 fallback)
    let home = FileManager.default.homeDirectoryForCurrentUser
    let vigili = home.appendingPathComponent(".vigili/daemon.log")
    let sentinel = home.appendingPathComponent(".sentinel/daemon.log")
    let url = FileManager.default.fileExists(atPath: vigili.path) ? vigili : sentinel
    NSWorkspace.shared.open(url)
  }
}
