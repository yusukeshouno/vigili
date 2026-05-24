import SwiftUI

/// pending 一覧 + 個別カードに対する Allow/Deny。
/// Mac の PopoverContentView と思想は同じだが、iOS 用に縦長レイアウト + 大きめタップ領域。
struct MobileQueueView: View {
  @EnvironmentObject private var coordinator: MobileAppCoordinator
  @State private var showSettings = false

  var body: some View {
    VStack(spacing: 0) {
      topBar
      Divider().background(Theme.border)

      if coordinator.pending.isEmpty {
        Spacer()
        StandingWatchView(wsState: coordinator.wsState)
        Spacer()
      } else {
        cardList
        actionsBar
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(Theme.bg.ignoresSafeArea())
    .sheet(isPresented: $showSettings) {
      MobileSettingsSheet(showSettings: $showSettings)
        .environmentObject(coordinator)
        .presentationDetents([.medium])
    }
  }

  private var topBar: some View {
    HStack(spacing: 10) {
      FlowerLogo(
        color: coordinator.pendingCount > 0 ? Theme.accent : Theme.fgMid,
        size: 26
      )
      VStack(alignment: .leading, spacing: 2) {
        Text("Vigili")
          .font(.display(18, weight: .semibold))
          .foregroundStyle(Theme.fg)
        Text(stateLabel)
          .font(.mono(10))
          .tracking(0.12 * 10)
          .textCase(.uppercase)
          .foregroundStyle(Theme.fgDim)
      }
      Spacer()
      Button {
        showSettings = true
      } label: {
        Image(systemName: "gearshape")
          .foregroundStyle(Theme.fgMid)
          .font(.system(size: 18))
      }
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 14)
  }

  private var cardList: some View {
    let sorted = coordinator.pending.sorted(by: { $0.createdAt > $1.createdAt })
    return ScrollView {
      VStack(spacing: 14) {
        ForEach(Array(sorted.enumerated()), id: \.element.id) { idx, req in
          ApprovalCard(request: req)
            .opacity(idx == 0 ? 1.0 : 0.55)
            .scaleEffect(idx == 0 ? 1.0 : 0.985)
            .transition(.scale(scale: 0.95).combined(with: .opacity))
        }
      }
      .padding(.horizontal, 18)
      .padding(.vertical, 14)
      .animation(.spring(response: 0.4, dampingFraction: 0.85), value: coordinator.pending.count)
    }
  }

  private var actionsBar: some View {
    let topCard = coordinator.pending.sorted(by: { $0.createdAt > $1.createdAt }).first
    return HStack(spacing: 12) {
      PillButton(
        label: "Deny",
        icon: "xmark",
        style: .ghost,
        action: { if let id = topCard?.id { coordinator.decide(id: id, decision: "deny") } }
      )
      PillButton(
        label: "Allow",
        icon: "checkmark",
        style: .primary,
        action: { if let id = topCard?.id { coordinator.decide(id: id, decision: "allow") } }
      )
    }
    .padding(.horizontal, 18)
    .padding(.bottom, 22)
    .padding(.top, 8)
    .background(Theme.bg)
  }

  private var stateLabel: String {
    switch coordinator.wsState {
    case .disconnected: return "disconnected"
    case .connecting: return "connecting…"
    case .connected:
      return coordinator.pendingCount > 0
        ? "\(coordinator.pendingCount) pending"
        : "watching · 0 pending"
    case .failed(let msg): return "ws: \(msg)"
    }
  }
}

// MARK: - Settings sheet (簡易)

struct MobileSettingsSheet: View {
  @EnvironmentObject private var coordinator: MobileAppCoordinator
  @Binding var showSettings: Bool

  var body: some View {
    ZStack {
      Theme.bg.ignoresSafeArea()
      VStack(spacing: 16) {
        HStack {
          Text("Settings")
            .font(.display(20, weight: .semibold))
            .foregroundStyle(Theme.fg)
          Spacer()
          Button("Done") { showSettings = false }
            .foregroundStyle(Theme.accent)
        }
        .padding(.top, 24)

        VStack(alignment: .leading, spacing: 12) {
          row(label: "Active route", value: routeString)
          if let lan = MobileSettings.lanUrl, !lan.isEmpty {
            row(label: "LAN", value: lan)
          }
          if let relay = MobileSettings.relayUrl, !relay.isEmpty,
            let pid = MobileSettings.relayPid
          {
            row(label: "Relay", value: "\(relay) (pid: \(pid.prefix(8))…)")
          }
          row(label: "WS state", value: stateString)
        }
        .padding(16)
        .background(
          RoundedRectangle(cornerRadius: 12).fill(Theme.bgRise)
        )

        PillButton(
          label: "Reset & log out",
          icon: "arrow.uturn.backward",
          style: .ghost,
          action: {
            coordinator.resetSettings()
            showSettings = false
          }
        )

        Spacer()
      }
      .padding(.horizontal, 18)
    }
  }

  private func row(label: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(label)
        .font(.mono(10, weight: .medium))
        .tracking(0.12 * 10)
        .textCase(.uppercase)
        .foregroundStyle(Theme.fgMid)
      Text(value)
        .font(.mono(12))
        .foregroundStyle(Theme.fg)
        .lineLimit(2)
        .truncationMode(.tail)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var stateString: String {
    switch coordinator.wsState {
    case .disconnected: return "disconnected"
    case .connecting: return "connecting…"
    case .connected: return "connected"
    case .failed(let m): return "failed: \(m)"
    }
  }

  private var routeString: String {
    switch coordinator.activeRoute {
    case .none: return "—"
    case .lan(let h): return "LAN · \(h)"
    case .relay(let h): return "relay · \(h)"
    }
  }
}
