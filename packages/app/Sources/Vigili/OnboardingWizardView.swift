import SwiftUI

/// 対話型のルール設定ウィザード。
///
/// フロー:
///   intro → 1 項目ずつ「はい / いいえ」で答える → summary → 完了
///
/// 戻る・スキップ・「ルールなしで完了」も任意のタイミングで可能。
struct OnboardingWizardView: View {
  @EnvironmentObject private var coordinator: AppCoordinator

  @State private var catalog: [DaemonAdminClient.CatalogItem] = []
  @State private var selected: Set<String> = []
  /// -1 = intro, 0..catalog.count-1 = 各項目, catalog.count = summary
  @State private var stepIndex: Int = -1
  @State private var isLoading = true
  @State private var isWriting = false
  @State private var errorMessage: String?
  /// caution 付き項目の「リスクを理解した」チェック。ステップ遷移ごとにリセット。
  @State private var riskAcknowledged = false

  var onCompletion: ((_ wrote: Bool) -> Void)?

  var body: some View {
    VStack(spacing: 0) {
      progressBar
      content
      footer
    }
    .frame(width: 560, height: 620)
    .background(Theme.bg)
    .preferredColorScheme(.dark)
    .task { await loadCatalog() }
    // 戻る/進むのたびにリスク確認チェックをリセットする (項目ごとに毎回確認させる)
    .onChange(of: stepIndex) { _ in riskAcknowledged = false }
  }

  // MARK: - sections

  private var progressBar: some View {
    HStack(spacing: 8) {
      FlowerLogo(color: Theme.accent, size: 14)
      Text("ルール設定")
        .font(.mono(10, weight: .semibold))
        .tracking(0.12 * 10)
        .foregroundStyle(Theme.fgMid)
      Spacer()
      if stepIndex >= 0 && stepIndex < catalog.count {
        Text("\(stepIndex + 1) / \(catalog.count)")
          .font(.mono(10))
          .foregroundStyle(Theme.fgDim)
      } else if stepIndex == catalog.count {
        Text("確認")
          .font(.mono(10))
          .foregroundStyle(Theme.fgDim)
      }
    }
    .padding(.horizontal, 24)
    .padding(.top, 18)
    .padding(.bottom, 12)
  }

  @ViewBuilder
  private var content: some View {
    if isLoading {
      VStack(spacing: 10) {
        ProgressView().controlSize(.small)
        Text("loading…").font(.mono(10)).foregroundStyle(Theme.fgDim)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if let err = errorMessage {
      VStack(spacing: 10) {
        Image(systemName: "exclamationmark.triangle")
          .font(.system(size: 24))
          .foregroundStyle(Theme.red)
        Text(err)
          .font(.system(size: 12))
          .foregroundStyle(Theme.fgDim)
          .multilineTextAlignment(.center)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .padding()
    } else if stepIndex == -1 {
      introView
    } else if stepIndex < catalog.count {
      questionView(for: catalog[stepIndex])
    } else {
      summaryView
    }
  }

  private var introView: some View {
    VStack(alignment: .leading, spacing: 18) {
      FlowerLogo(color: Theme.accent, size: 32)
        .padding(.bottom, 4)
      Text("Vigili のルールを\n設定しましょう。")
        .font(.display(26, weight: .semibold))
        .foregroundStyle(Theme.fg)
        .fixedSize(horizontal: false, vertical: true)
      Text(
        """
        Claude Code が「何か実行していい？」と聞いてきたとき、Vigili が自動で許可するかどうかを決められます。

        まず、よくある操作について「自動で許可するか・しないか」を一つずつ確認します。
        いつでも変更でき、後から「今後は自動で承認」ボタンでも増やせます。
        """
      )
      .font(.system(size: 13))
      .foregroundStyle(Theme.fgMid)
      .lineSpacing(4)
      .fixedSize(horizontal: false, vertical: true)
      Spacer()
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 36)
    .padding(.top, 8)
  }

  private func questionView(for item: DaemonAdminClient.CatalogItem) -> some View {
    let isDanger = item.category == "danger"
    return ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        // カテゴリラベル
        Text(isDanger ? "防御ルール" : "自動許可")
          .font(.mono(9, weight: .semibold))
          .tracking(0.12 * 9)
          .foregroundStyle(isDanger ? Theme.amber : Theme.accent)

        // 質問の主役テキスト
        Text(item.label)
          .font(.display(22, weight: .semibold))
          .foregroundStyle(Theme.fg)
          .fixedSize(horizontal: false, vertical: true)

        // 詳細説明 (何が許可されるか / 判定の限界)
        Text(item.detail)
          .font(.system(size: 13))
          .foregroundStyle(Theme.fgMid)
          .lineSpacing(4)
          .fixedSize(horizontal: false, vertical: true)

        // 防御ルールの説明 (danger 系は自動許可ではない)
        if isDanger {
          HStack(alignment: .top, spacing: 6) {
            Image(systemName: "shield")
              .font(.system(size: 11))
              .foregroundStyle(Theme.amber.opacity(0.8))
              .padding(.top, 2)
            Text(
              "この項目は操作を自動許可するものではありません。該当する操作を必ず確認に回し、最優先の通知でスマホを起こすルールです。"
            )
            .font(.system(size: 11))
            .foregroundStyle(Theme.fgDim)
            .lineSpacing(2)
          }
          .padding(10)
          .background(
            RoundedRectangle(cornerRadius: 8)
              .fill(Theme.amber.opacity(0.08))
          )
        }

        // リスク確認 (caution 付き自動許可): チェックするまで「はい」が押せない
        if let caution = item.caution {
          VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 6) {
              Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 11))
                .foregroundStyle(Theme.red.opacity(0.8))
                .padding(.top, 2)
              Text(caution)
                .font(.system(size: 11))
                .foregroundStyle(Theme.fgMid)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            }
            Toggle(isOn: $riskAcknowledged) {
              Text("リスクを理解した上で自動許可する")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Theme.fg)
            }
            .toggleStyle(.checkbox)
          }
          .padding(10)
          .background(
            RoundedRectangle(cornerRadius: 8)
              .fill(Theme.red.opacity(0.08))
          )
        }

        Spacer(minLength: 0)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.horizontal, 36)
      .padding(.top, 4)
    }
  }

  private var summaryView: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("確認")
        .font(.display(22, weight: .semibold))
        .foregroundStyle(Theme.fg)

      if selected.isEmpty {
        Text("自動承認ルールを 1 つも作りません。\nすべてのリクエストで Vigili が dialog を出します。\n後から「今後は自動で承認」で追加できます。")
          .font(.system(size: 13))
          .foregroundStyle(Theme.fgMid)
          .lineSpacing(3)
      } else {
        Text("以下のルールを作成します:")
          .font(.system(size: 13))
          .foregroundStyle(Theme.fgMid)

        ScrollView {
          VStack(alignment: .leading, spacing: 6) {
            ForEach(catalog.filter { selected.contains($0.id) }) { item in
              HStack(alignment: .top, spacing: 8) {
                Image(systemName: "checkmark")
                  .font(.system(size: 10, weight: .semibold))
                  .foregroundStyle(Theme.accent)
                  .padding(.top, 3)
                VStack(alignment: .leading, spacing: 1) {
                  Text(item.label)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Theme.fg)
                  Text(item.description)
                    .font(.mono(10))
                    .foregroundStyle(Theme.fgDim)
                    .lineLimit(2)
                }
              }
            }
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(12)
          .background(
            RoundedRectangle(cornerRadius: 8)
              .fill(Theme.bgRise)
          )
        }
        .frame(maxHeight: 280)
      }

      Spacer()
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 36)
    .padding(.top, 4)
  }

  // MARK: - footer

  @ViewBuilder
  private var footer: some View {
    Divider().background(Theme.border)
    HStack(spacing: 10) {
      // 左: スキップ または 戻る
      if stepIndex == -1 {
        Button {
          onCompletion?(false)
        } label: {
          Text("スキップ")
            .font(.mono(11))
            .foregroundStyle(Theme.fgDim)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .disabled(isWriting)
      } else {
        Button {
          stepIndex -= 1
        } label: {
          HStack(spacing: 4) {
            Image(systemName: "chevron.left")
              .font(.system(size: 10))
            Text("戻る")
              .font(.mono(11))
          }
          .foregroundStyle(Theme.fgMid)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .disabled(isWriting)
      }

      Spacer()

      // 中央/右: メインのアクションボタン
      mainActionButtons
    }
    .padding(.horizontal, 20)
    .padding(.vertical, 14)
  }

  @ViewBuilder
  private var mainActionButtons: some View {
    if isWriting {
      ProgressView().controlSize(.small)
    } else if stepIndex == -1 {
      // intro: 始める
      Button {
        stepIndex = 0
      } label: {
        Text("はじめる")
          .font(.mono(12, weight: .semibold))
          .foregroundStyle(Theme.fg)
          .padding(.horizontal, 18)
          .padding(.vertical, 8)
          .background(
            RoundedRectangle(cornerRadius: 8)
              .fill(Theme.accent.opacity(0.85))
          )
      }
      .buttonStyle(.plain)
    } else if stepIndex < catalog.count {
      // 質問中: いいえ / はい。
      // danger 系は「防御ルールの有効化」なので文言を変える (自動許可ではない)。
      // caution 付きはリスク確認チェックを入れるまで「はい」を押せない。
      let item = catalog[stepIndex]
      let isDanger = item.category == "danger"
      let yesBlocked = item.caution != nil && !riskAcknowledged
      HStack(spacing: 8) {
        Button {
          selected.remove(item.id)
          advance()
        } label: {
          Text(isDanger ? "設定しない" : "いいえ（毎回確認する）")
            .font(.mono(11))
            .foregroundStyle(Theme.fg)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
              RoundedRectangle(cornerRadius: 8)
                .stroke(Theme.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)

        Button {
          selected.insert(item.id)
          advance()
        } label: {
          Text(isDanger ? "有効にする（推奨）" : "はい（自動で許可）")
            .font(.mono(11, weight: .semibold))
            .foregroundStyle(yesBlocked ? Theme.fgDim : Theme.fg)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
              RoundedRectangle(cornerRadius: 8)
                .fill(Theme.accent.opacity(yesBlocked ? 0.25 : 0.85))
            )
        }
        .buttonStyle(.plain)
        .disabled(yesBlocked)
        .help(yesBlocked ? "上のリスク確認にチェックを入れると選択できます" : "")
      }
    } else {
      // summary: 完了
      Button {
        Task { await complete() }
      } label: {
        Text(selected.isEmpty ? "ルールなしで完了" : "このルールで完了")
          .font(.mono(12, weight: .semibold))
          .foregroundStyle(Theme.fg)
          .padding(.horizontal, 18)
          .padding(.vertical, 8)
          .background(
            RoundedRectangle(cornerRadius: 8)
              .fill(Theme.accent.opacity(0.85))
          )
      }
      .buttonStyle(.plain)
    }
  }

  // MARK: - actions

  private func advance() {
    stepIndex += 1
  }

  @MainActor
  private func loadCatalog() async {
    isLoading = true
    errorMessage = nil
    do {
      catalog = try await coordinator.adminClient.fetchPolicyCatalog()
      // convenience カテゴリはデフォルト全選択。danger 系はデフォルト非選択。
      // ユーザーは各ステップで個別に外せる。
      if selected.isEmpty {
        selected = Set(catalog.filter { $0.category == "convenience" }.map(\.id))
      }
    } catch {
      errorMessage = error.localizedDescription
    }
    isLoading = false
  }

  @MainActor
  private func complete() async {
    isWriting = true
    errorMessage = nil
    do {
      _ = try await coordinator.adminClient.writePolicyFromCatalog(
        selectedIds: Array(selected)
      )
      onCompletion?(true)
    } catch {
      errorMessage = error.localizedDescription
    }
    isWriting = false
  }
}
