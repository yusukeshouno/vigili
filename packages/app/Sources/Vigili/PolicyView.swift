import SwiftUI

/// ポリシールール一覧と自動処理履歴を見るパネル。
/// フッターの shield アイコンから NSPanel として開く。
struct PolicyView: View {
  @EnvironmentObject private var coordinator: AppCoordinator
  @State private var selectedTab: Tab = .history
  @State private var rules: [PolicyRule] = []
  @State private var generatedRuleNames: Set<String> = []
  @State private var history: [PolicyHistoryItem] = []
  @State private var isLoading = false
  @State private var errorMessage: String?
  @State private var deletingRuleName: String?

  enum Tab: String, CaseIterable {
    case history = "History"
    case rules = "Rules"
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
      tabBar
      Divider().background(Theme.border)
      content
    }
    .frame(width: 480, height: 420)
    .background(Theme.bg)
    .preferredColorScheme(.dark)
    .task { await refresh() }
  }

  // MARK: - sections

  private var header: some View {
    HStack(spacing: 10) {
      Image(systemName: "shield.lefthalf.filled")
        .font(.system(size: 14))
        .foregroundStyle(Theme.fgMid)
      Text("Policy")
        .font(.display(15, weight: .semibold))
        .foregroundStyle(Theme.fg)
      Spacer()
      Button {
        OnboardingWindow.show(coordinator: coordinator) { wrote in
          if wrote { Task { await refresh() } }
        }
      } label: {
        Image(systemName: "wand.and.stars")
          .font(.system(size: 11))
          .foregroundStyle(Theme.fgMid)
      }
      .buttonStyle(.plain)
      .help("ルール設定ウィザードを再実行")
      Button {
        Task { await refresh() }
      } label: {
        Image(systemName: "arrow.clockwise")
          .font(.system(size: 11))
          .foregroundStyle(isLoading ? Theme.fgDim : Theme.fgMid)
      }
      .buttonStyle(.plain)
      .disabled(isLoading)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }

  private var tabBar: some View {
    HStack(spacing: 0) {
      ForEach(Tab.allCases, id: \.self) { tab in
        Button {
          selectedTab = tab
        } label: {
          VStack(spacing: 4) {
            Text(tab.rawValue)
              .font(.mono(10, weight: selectedTab == tab ? .semibold : .regular))
              .foregroundStyle(selectedTab == tab ? Theme.fg : Theme.fgDim)
            Rectangle()
              .fill(selectedTab == tab ? Theme.accent : Color.clear)
              .frame(height: 1.5)
          }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
      }
    }
    .padding(.horizontal, 16)
  }

  @ViewBuilder
  private var content: some View {
    if isLoading && history.isEmpty && rules.isEmpty {
      VStack(spacing: 8) {
        ProgressView().controlSize(.small)
        Text("loading…").font(.mono(10)).foregroundStyle(Theme.fgDim)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if let err = errorMessage {
      VStack(spacing: 8) {
        Image(systemName: "exclamationmark.triangle")
          .font(.system(size: 18))
          .foregroundStyle(Theme.red)
        Text(err)
          .font(.mono(10))
          .foregroundStyle(Theme.fgDim)
          .multilineTextAlignment(.center)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .padding()
    } else if selectedTab == .history {
      historyTab
    } else {
      rulesTab
    }
  }

  // MARK: - History tab

  private var historyTab: some View {
    Group {
      if history.isEmpty {
        VStack(spacing: 8) {
          Image(systemName: "clock.badge.checkmark")
            .font(.system(size: 22))
            .foregroundStyle(Theme.fgDim)
          Text("まだ自動処理された項目がありません")
            .font(.system(size: 12))
            .foregroundStyle(Theme.fgDim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ScrollView {
          LazyVStack(spacing: 0) {
            ForEach(history) { item in
              historyRow(item)
              Divider().background(Theme.border).padding(.horizontal, 16)
            }
          }
          .padding(.vertical, 4)
        }
      }
    }
  }

  private func historyRow(_ item: PolicyHistoryItem) -> some View {
    HStack(spacing: 10) {
      // decision badge
      Text(item.decision.uppercased())
        .font(.mono(8, weight: .semibold))
        .foregroundStyle(item.decision == "allow" ? Theme.green : Theme.red)
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(
          Capsule().fill(
            (item.decision == "allow" ? Theme.green : Theme.red).opacity(0.15)
          )
        )
        .frame(width: 44)

      VStack(alignment: .leading, spacing: 2) {
        Text(item.toolInputSummary)
          .font(.mono(10))
          .foregroundStyle(Theme.fg)
          .lineLimit(1)
          .truncationMode(.middle)
        HStack(spacing: 6) {
          Text(item.toolName)
            .font(.mono(9))
            .foregroundStyle(Theme.fgDim)
          Text("·")
            .foregroundStyle(Theme.fgDim)
          Text(item.ruleName)
            .font(.mono(9))
            .foregroundStyle(Theme.accent.opacity(0.8))
        }
      }

      Spacer()

      Text(item.createdAt, style: .time)
        .font(.mono(9))
        .foregroundStyle(Theme.fgDim)
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
    .contentShape(Rectangle())
  }

  // MARK: - Rules tab

  private var rulesTab: some View {
    Group {
      if rules.isEmpty {
        VStack(spacing: 8) {
          Image(systemName: "doc.text.magnifyingglass")
            .font(.system(size: 22))
            .foregroundStyle(Theme.fgDim)
          Text("ルールがロードされていません")
            .font(.system(size: 12))
            .foregroundStyle(Theme.fgDim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ScrollView {
          LazyVStack(spacing: 0) {
            // generated ルール (削除可能) を先に
            let generated = rules.filter { generatedRuleNames.contains($0.name) }
            let main = rules.filter { !generatedRuleNames.contains($0.name) }

            if !generated.isEmpty {
              sectionHeader("AUTO-PROMOTED")
              ForEach(generated) { rule in
                ruleRow(rule, isGenerated: true)
                Divider().background(Theme.border).padding(.horizontal, 16)
              }
            }
            if !main.isEmpty {
              sectionHeader("POLICY.YAML")
              ForEach(main) { rule in
                ruleRow(rule, isGenerated: false)
                Divider().background(Theme.border).padding(.horizontal, 16)
              }
            }
          }
          .padding(.vertical, 4)
        }
      }
    }
  }

  private func sectionHeader(_ title: String) -> some View {
    Text(title)
      .font(.mono(8, weight: .semibold))
      .tracking(0.12 * 8)
      .foregroundStyle(Theme.fgDim)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 16)
      .padding(.top, 10)
      .padding(.bottom, 4)
  }

  private func ruleRow(_ rule: PolicyRule, isGenerated: Bool) -> some View {
    HStack(spacing: 10) {
      // action badge
      actionBadge(rule.action)
        .frame(width: 44)

      VStack(alignment: .leading, spacing: 2) {
        Text(rule.name)
          .font(.mono(10, weight: .medium))
          .foregroundStyle(Theme.fg)
          .lineLimit(1)
        Text(rule.whenSummary)
          .font(.mono(9))
          .foregroundStyle(Theme.fgDim)
          .lineLimit(1)
          .truncationMode(.tail)
      }

      Spacer()

      if isGenerated {
        VStack(alignment: .trailing, spacing: 2) {
          if let label = rule.expiryLabel {
            Text(label)
              .font(.mono(8))
              .foregroundStyle(rule.isExpired ? Theme.red : Theme.fgDim)
          }
          Button {
            Task { await deleteRule(name: rule.name) }
          } label: {
            Image(systemName: deletingRuleName == rule.name ? "clock" : "trash")
              .font(.system(size: 11))
              .foregroundStyle(Theme.fgDim)
          }
          .buttonStyle(.plain)
          .disabled(deletingRuleName != nil)
          .help("このルールを削除して policy をリロード")
        }
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 8)
    .contentShape(Rectangle())
    .opacity(rule.isExpired ? 0.4 : 1.0)
  }

  private func actionBadge(_ action: String) -> some View {
    let color: Color = action == "allow" ? Theme.green : action == "deny" ? Theme.red : Theme.accent
    return Text(action.uppercased())
      .font(.mono(8, weight: .semibold))
      .foregroundStyle(color)
      .padding(.horizontal, 5)
      .padding(.vertical, 2)
      .background(Capsule().fill(color.opacity(0.15)))
  }

  // MARK: - data loading

  @MainActor
  private func refresh() async {
    isLoading = true
    errorMessage = nil
    do {
      async let rulesResult = coordinator.adminClient.fetchRules()
      async let historyResult = coordinator.adminClient.fetchHistory()
      let (r, h) = try await (rulesResult, historyResult)
      rules = r.rules
      generatedRuleNames = r.generatedRuleNames
      history = h
    } catch {
      errorMessage = error.localizedDescription
    }
    isLoading = false
  }

  @MainActor
  private func deleteRule(name: String) async {
    deletingRuleName = name
    do {
      try await coordinator.adminClient.deleteGeneratedRule(name: name)
      // リロードして反映
      await refresh()
    } catch {
      errorMessage = error.localizedDescription
    }
    deletingRuleName = nil
  }
}
