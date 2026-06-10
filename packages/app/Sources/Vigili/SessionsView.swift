import SwiftUI

/// L4 ホスト型セッション (`vigili run`) の transcript 表示 + 回答 UI（macOS）。
///
/// popover は縦が狭いので独立ウィンドウ (SessionsWindow) で開く。
/// 左に稼働セッション一覧、右に選択セッションの transcript チャット +
/// 未回答の質問 (AskUserQuestion) / plan (ExitPlanMode) の回答 UI + 自由文返信。
///
/// チャット吹き出し・質問/plan 回答・返信欄は Shared/SessionChatViews.swift に集約し
/// iOS (MobileSessionsView) と共用する。ここは macOS のウィンドウレイアウト専用。
///
/// ホスト型セッションの「ツール許可」は通常の承認キュー (popover) に出るので
/// ここでは扱わない。ここは「会話 + 選択肢/plan/返信」専用。
struct SessionsView: View {
  @EnvironmentObject private var coordinator: AppCoordinator
  let onClose: () -> Void

  @State private var selectedId: String?

  var body: some View {
    VStack(spacing: 0) {
      header
      Rectangle().fill(Theme.border).frame(height: 1)
      if coordinator.sessions.isEmpty {
        emptyState
      } else {
        HStack(spacing: 0) {
          sessionList
            .frame(width: 220)
          Rectangle().fill(Theme.border).frame(width: 1)
          detail
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      }
    }
    .frame(minWidth: 680, minHeight: 640)
    .background(Theme.bg)
    .preferredColorScheme(.dark)
    .onAppear(perform: selectDefault)
    .onChange(of: coordinator.sessions.map(\.id)) { _ in selectDefault() }
  }

  // MARK: - header

  private var header: some View {
    HStack(spacing: 10) {
      FlowerLogo(color: actionableCount > 0 ? Theme.accent : Theme.fgMid, size: 15)
      Text("Sessions")
        .font(.display(15, weight: .semibold))
        .foregroundStyle(Theme.fg)
      if actionableCount > 0 {
        Text("\(actionableCount) NEEDS YOU")
          .monoLabel(9, weight: .semibold)
          .foregroundStyle(Theme.accent)
          .padding(.horizontal, 6)
          .padding(.vertical, 2)
          .background(
            Capsule().fill(Theme.accent.opacity(0.1))
              .overlay(Capsule().stroke(Theme.accent.opacity(0.5), lineWidth: 0.5))
          )
      }
      Spacer()
      Button(action: onClose) {
        Image(systemName: "xmark")
          .font(.system(size: 11, weight: .medium))
          .foregroundStyle(Theme.fgMid)
      }
      .buttonStyle(.plain)
      .help("Close")
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 12)
  }

  /// 未回答の質問 / plan を持つセッション数 (バッジ用)。
  private var actionableCount: Int {
    let ids = Set(coordinator.pendingQuestions.map(\.sessionId))
      .union(coordinator.pendingPlans.map(\.sessionId))
    return ids.count
  }

  // MARK: - empty

  private var emptyState: some View {
    VStack(spacing: 10) {
      Spacer()
      Image(systemName: "bubble.left.and.bubble.right")
        .font(.system(size: 30))
        .foregroundStyle(Theme.fgFaint)
      Text("稼働中のセッションはありません")
        .font(.display(14))
        .foregroundStyle(Theme.fgMid)
      Text("ターミナルで `vigili run` を実行すると\nここに会話が流れ込みます。")
        .font(.mono(11))
        .multilineTextAlignment(.center)
        .foregroundStyle(Theme.fgDim)
      Spacer()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  // MARK: - session list

  private var sessionList: some View {
    ScrollView {
      VStack(spacing: 4) {
        ForEach(coordinator.sessions.sorted { $0.startedAt > $1.startedAt }) { session in
          sessionRow(session)
        }
      }
      .padding(8)
    }
    .background(Theme.bgRise.opacity(0.4))
  }

  private func sessionRow(_ session: HostedSession) -> some View {
    let selected = session.id == selectedId
    let needs = sessionNeedsAttention(session.id)
    return Button {
      selectedId = session.id
    } label: {
      HStack(spacing: 8) {
        Circle()
          .fill(statusColor(session.status))
          .frame(width: 7, height: 7)
        VStack(alignment: .leading, spacing: 2) {
          Text(session.displayName)
            .font(.display(12, weight: .medium))
            .foregroundStyle(Theme.fg)
            .lineLimit(1)
          Text(session.cwd)
            .font(.mono(9))
            .foregroundStyle(Theme.fgDim)
            .lineLimit(1)
            .truncationMode(.head)
        }
        Spacer(minLength: 4)
        if needs {
          Circle().fill(Theme.accent).frame(width: 6, height: 6)
        }
      }
      .padding(.horizontal, 8)
      .padding(.vertical, 7)
      .background(
        RoundedRectangle(cornerRadius: 8)
          .fill(selected ? Theme.bgRise2 : Color.clear)
      )
      .contentShape(RoundedRectangle(cornerRadius: 8))
    }
    .buttonStyle(.plain)
  }

  private func sessionNeedsAttention(_ id: String) -> Bool {
    coordinator.pendingQuestions.contains { $0.sessionId == id }
      || coordinator.pendingPlans.contains { $0.sessionId == id }
  }

  private func statusColor(_ status: String) -> Color {
    switch status {
    case "awaiting": return Theme.amber
    case "running": return Theme.green
    default: return Theme.fgDim
    }
  }

  // MARK: - detail

  @ViewBuilder
  private var detail: some View {
    if let id = selectedId, let session = coordinator.sessions.first(where: { $0.id == id }) {
      VStack(spacing: 0) {
        detailHeader(session)
        Rectangle().fill(Theme.border).frame(height: 1)
        if session.observed {
          // observed session (gate 経由の合成、SPEC §8.5.1): transcript なし
          ObservedSessionInfo(session: session)
        } else {
          TranscriptScroll(lines: coordinator.transcripts[id] ?? [])
          answerArea(sessionId: id)
        }
      }
    } else {
      Color.clear
    }
  }

  private func detailHeader(_ session: HostedSession) -> some View {
    HStack(spacing: 8) {
      Circle().fill(statusColor(session.status)).frame(width: 8, height: 8)
      Text(session.displayName)
        .font(.display(13, weight: .semibold))
        .foregroundStyle(Theme.fg)
      Text(session.status)
        .monoLabel(9)
        .foregroundStyle(Theme.fgMid)
      Spacer()
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
  }

  /// 選択中セッションの未回答質問 / plan / 返信欄。
  @ViewBuilder
  private func answerArea(sessionId: String) -> some View {
    VStack(spacing: 0) {
      if let q = coordinator.pendingQuestions.first(where: { $0.sessionId == sessionId }) {
        Rectangle().fill(Theme.border).frame(height: 1)
        QuestionAnswerView(pending: q) { answers in
          coordinator.answerQuestion(requestId: q.requestId, answers: answers)
        }
      }
      if let p = coordinator.pendingPlans.first(where: { $0.sessionId == sessionId }) {
        Rectangle().fill(Theme.border).frame(height: 1)
        PlanAnswerView(pending: p) { decision in
          coordinator.decidePlan(requestId: p.requestId, decision: decision)
        }
      }
      Rectangle().fill(Theme.border).frame(height: 1)
      ReplyComposer { body in
        coordinator.sendSessionReply(sessionId: sessionId, body: body)
      }
    }
  }

  // MARK: - selection

  private func selectDefault() {
    if let id = selectedId, coordinator.sessions.contains(where: { $0.id == id }) {
      return
    }
    let actionable = coordinator.sessions.first { sessionNeedsAttention($0.id) }
    selectedId = actionable?.id ?? coordinator.sessions.first?.id
  }
}
