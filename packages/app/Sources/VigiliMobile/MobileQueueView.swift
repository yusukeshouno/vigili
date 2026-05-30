import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// pending 一覧 + 個別カードに対する Allow/Deny。
/// Mac の PopoverContentView と思想は同じだが、iOS 用に縦長レイアウト + 大きめタップ領域。
struct MobileQueueView: View {
  @EnvironmentObject private var coordinator: MobileAppCoordinator
  @State private var showSettings = false
  /// id → "allow" | "deny"  — tracks cards mid-exit for color flash + direction
  @State private var decidedIds: [String: String] = [:]
  /// ロゴをバウンスさせるトリガー (pending が増えるたび)
  @State private var logoPop = false

  private func decide(id: String, decision: String) {
    // ハプティクス
    #if canImport(UIKit)
    let gen = UIImpactFeedbackGenerator(style: decision == "allow" ? .medium : .rigid)
    gen.impactOccurred()
    #endif

    withAnimation(.spring(response: 0.22, dampingFraction: 0.55)) {
      decidedIds[id] = decision
    }
    Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(80))
      coordinator.decide(id: id, decision: decision)
    }
  }

  private func decideAndPromote(request: ApprovalRequest) {
    #if canImport(UIKit)
    let gen = UIImpactFeedbackGenerator(style: .medium)
    gen.impactOccurred()
    #endif

    withAnimation(.spring(response: 0.22, dampingFraction: 0.55)) {
      decidedIds[request.id] = "allow"
    }
    Task { @MainActor in
      try? await Task.sleep(for: .milliseconds(80))
      coordinator.decideAndPromote(id: request.id, request: request)
    }
  }

  var body: some View {
    VStack(spacing: 0) {
      topBar
      Divider().background(Theme.border)

      // pending ↔ idle(レーダー) の切り替え。コンテナはフェードのみとし、
      // 「浮かび上がる」演出は StandingWatchView 内部の段階的 intro
      // (ライン→星→レーダー→文字) に任せる。
      Group {
        if coordinator.pending.isEmpty {
          idleView
            .transition(.opacity)
        } else {
          VStack(spacing: 0) {
            cardList
            actionsBar
          }
          .transition(.opacity)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .animation(.easeOut(duration: 0.7), value: coordinator.pending.isEmpty)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    .background(Theme.bg.ignoresSafeArea())
    .sheet(isPresented: $showSettings) {
      MobileSettingsSheet(showSettings: $showSettings)
        .environmentObject(coordinator)
        .presentationDetents([.medium])
    }
  }

  /// pending が無いときの待機画面。
  /// design "Vigili — standing watch (Footer B)" 準拠: レーダーを主役として上半分の
  /// 余白に縦中央寄せし、静かな 3 カラム台帳フッターを画面下端にピン留めする。
  private var idleView: some View {
    VStack(spacing: 0) {
      Spacer(minLength: 0)
      StandingWatchView(wsState: coordinator.wsState)
      Spacer(minLength: 0)
      StandingWatchLedger()
    }
  }

  private var topBar: some View {
    HStack(spacing: 10) {
      FlowerLogo(
        color: coordinator.pendingCount > 0 ? Theme.accent : Theme.fgMid,
        size: 20
      )
      // バウンス: pending が届くたびロゴが jump する
      .scaleEffect(logoPop ? 1.45 : 1.0)
      .rotationEffect(.degrees(logoPop ? -12 : 0))
      .animation(
        .spring(response: 0.24, dampingFraction: 0.38),
        value: logoPop
      )
      .onChange(of: coordinator.pendingCount) { newVal in
        guard newVal > 0 else { return }
        logoPop = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.14) { logoPop = false }
      }

      VStack(alignment: .leading, spacing: 2) {
        Text("Vigili")
          .font(.display(18, weight: .semibold))
          .foregroundStyle(Theme.fg)
        Text(stateLabel)
          .font(.mono(10))
          .tracking(0.12 * 10)
          .textCase(.uppercase)
          .foregroundStyle(Theme.fgDim)
          .contentTransition(.numericText())
          .animation(.spring(response: 0.3, dampingFraction: 0.7), value: stateLabel)
      }
      Spacer()

      // pending バッジ
      if coordinator.pendingCount > 0 {
        Text("\(coordinator.pendingCount)")
          .font(.mono(11, weight: .bold))
          .foregroundStyle(Theme.accent)
          .padding(.horizontal, 7)
          .padding(.vertical, 3)
          .background(Capsule().stroke(Theme.accent.opacity(0.5), lineWidth: 1))
          .transition(.scale(scale: 0.3, anchor: .trailing).combined(with: .opacity))
          .id(coordinator.pendingCount) // key change triggers re-entrance animation
      }

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
    .animation(.spring(response: 0.32, dampingFraction: 0.65), value: coordinator.pendingCount)
  }

  private var cardList: some View {
    let sorted = coordinator.pending.sorted(by: { $0.createdAt > $1.createdAt })
    return ScrollView {
      VStack(spacing: 14) {
        ForEach(Array(sorted.enumerated()), id: \.element.id) { idx, req in
          ApprovalCard(request: req)
            // 上位カードをはっきり、後ろのカードを少し沈める
            .opacity(idx == 0 ? 1.0 : 0.52)
            .scaleEffect(
              x: idx == 0 ? 1.0 : max(0.93, 1.0 - Double(idx) * 0.025),
              y: idx == 0 ? 1.0 : max(0.93, 1.0 - Double(idx) * 0.025)
            )
            .offset(y: idx == 0 ? 0 : CGFloat(idx) * -6)
            .zIndex(Double(sorted.count - idx))
            // 決定フラッシュ
            .overlay {
              if let dec = decidedIds[req.id] {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                  .fill(
                    dec == "allow"
                      ? Color(red: 0.48, green: 0.78, blue: 0.55).opacity(0.28)
                      : Color(red: 0.88, green: 0.35, blue: 0.30).opacity(0.28)
                  )
              }
            }
            // 出現: 上から pop-in、消去: 決定方向に飛ぶ
            .transition(.asymmetric(
              insertion: .scale(scale: 0.84, anchor: .top)
                .combined(with: .opacity)
                .animation(.spring(response: 0.4, dampingFraction: 0.6)),
              removal: .move(edge: decidedIds[req.id] == "deny" ? .leading : .trailing)
                .combined(with: .opacity)
                .animation(.spring(response: 0.32, dampingFraction: 0.78))
            ))
            .onDisappear {
              let id = req.id
              Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(500))
                decidedIds.removeValue(forKey: id)
              }
            }
        }
      }
      .padding(.horizontal, 18)
      .padding(.vertical, 14)
      .animation(
        .spring(response: 0.36, dampingFraction: 0.68),
        value: coordinator.pending.count
      )
    }
  }

  private var actionsBar: some View {
    let topCard = coordinator.pending.sorted(by: { $0.createdAt > $1.createdAt }).first
    return VStack(spacing: 10) {
      // 主操作: Deny / Allow
      HStack(spacing: 12) {
        PillButton(
          label: "Deny",
          icon: "xmark",
          style: .ghost,
          action: { if let id = topCard?.id { decide(id: id, decision: "deny") } }
        )
        PillButton(
          label: "Allow",
          icon: "checkmark",
          style: .primary,
          action: { if let id = topCard?.id { decide(id: id, decision: "allow") } }
        )
      }

      // 副操作: 今後は自動で承認 (promote to rule) — 確認ダイアログ付き。
      // 危険操作 (.danger) は自動承認させない (常時 allow 化は取り返しがつかない)。
      if let card = topCard, RiskAssessment.evaluate(card).level == .danger {
        HStack(spacing: 5) {
          Image(systemName: "lock.fill")
            .font(.system(size: 11))
          Text("危険操作のため自動承認は無効")
            .font(.mono(11))
        }
        .foregroundStyle(Theme.fgDim)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
      } else {
        // Mac (PopoverContentView) と同じく確認ダイアログは出さない。誤爆しても
        // ルールは 24h で失効し、ポリシー画面から即削除できるので直接実行する。
        Button {
          if let card = topCard { decideAndPromote(request: card) }
        } label: {
          HStack(spacing: 7) {
            Image(systemName: "arrow.up.circle.fill")
              .font(.system(size: 16))
            Text("今後は自動で承認")
              .font(.mono(14, weight: .medium))
          }
          .foregroundStyle(Theme.fgMid)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 16)
          .background(
            RoundedRectangle(cornerRadius: 12)
              .stroke(Theme.borderStrong, lineWidth: 1)
          )
          .contentShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(topCard == nil)
      }
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
    case .lan(let h): return "local · \(h)"
    case .relay(let h): return "remote · \(h)"
    }
  }
}
