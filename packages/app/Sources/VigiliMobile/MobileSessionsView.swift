import SwiftUI

/// L4 ホスト型セッション (`vigili run`) の transcript + 回答 UI（iOS）。
///
/// MobileQueueView の 💬 ボタンから sheet で開く。NavigationStack で
/// 一覧 → 詳細 (transcript チャット + 質問/plan 回答 + 返信) に進む。
/// チャット吹き出し・質問/plan 回答・返信欄は Shared/SessionChatViews.swift と共用。
struct MobileSessionsView: View {
  @EnvironmentObject private var coordinator: MobileAppCoordinator
  let onClose: () -> Void

  @State private var path: [String] = []

  var body: some View {
    NavigationStack(path: $path) {
      Group {
        if coordinator.sessions.isEmpty {
          emptyState
        } else {
          list
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(Theme.bg.ignoresSafeArea())
      .navigationTitle("Sessions")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("閉じる") { onClose() }
            .foregroundStyle(Theme.fgMid)
        }
      }
      .navigationDestination(for: String.self) { sid in
        MobileSessionDetail(sessionId: sid)
      }
    }
    .preferredColorScheme(.dark)
  }

  private var emptyState: some View {
    VStack(spacing: 10) {
      Image(systemName: "bubble.left.and.bubble.right")
        .font(.system(size: 34))
        .foregroundStyle(Theme.fgFaint)
      Text("稼働中のセッションはありません")
        .font(.display(15))
        .foregroundStyle(Theme.fgMid)
      Text("Mac のターミナルで `vigili run` を実行すると\nここに会話が流れ込みます。")
        .font(.mono(11))
        .multilineTextAlignment(.center)
        .foregroundStyle(Theme.fgDim)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private var list: some View {
    ScrollView {
      VStack(spacing: 8) {
        ForEach(coordinator.sessions.sorted { $0.startedAt > $1.startedAt }) { session in
          NavigationLink(value: session.id) {
            row(session)
          }
          .buttonStyle(.plain)
        }
      }
      .padding(16)
    }
  }

  private func row(_ session: HostedSession) -> some View {
    let needs = coordinator.pendingQuestions.contains { $0.sessionId == session.id }
      || coordinator.pendingPlans.contains { $0.sessionId == session.id }
    return HStack(spacing: 10) {
      Circle().fill(statusColor(session.status)).frame(width: 8, height: 8)
      VStack(alignment: .leading, spacing: 3) {
        Text(session.displayName)
          .font(.display(15, weight: .medium))
          .foregroundStyle(Theme.fg)
          .lineLimit(1)
        Text(session.cwd)
          .font(.mono(10))
          .foregroundStyle(Theme.fgDim)
          .lineLimit(1)
          .truncationMode(.head)
      }
      Spacer(minLength: 6)
      if needs {
        Text("要回答")
          .monoLabel(9, weight: .semibold)
          .foregroundStyle(Theme.accent)
          .padding(.horizontal, 6)
          .padding(.vertical, 2)
          .background(Capsule().stroke(Theme.accent.opacity(0.5), lineWidth: 0.5))
      }
      Image(systemName: "chevron.right")
        .font(.system(size: 12))
        .foregroundStyle(Theme.fgDim)
    }
    .padding(14)
    .background(
      RoundedRectangle(cornerRadius: 12).fill(Theme.bgRise)
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.border, lineWidth: 1))
    )
  }

  private func statusColor(_ status: String) -> Color {
    switch status {
    case "awaiting": return Theme.amber
    case "running": return Theme.green
    default: return Theme.fgDim
    }
  }
}

/// 個別セッションの詳細: transcript チャット + 未回答の質問/plan 回答 + 返信。
private struct MobileSessionDetail: View {
  @EnvironmentObject private var coordinator: MobileAppCoordinator
  let sessionId: String

  var body: some View {
    VStack(spacing: 0) {
      TranscriptScroll(lines: coordinator.transcripts[sessionId] ?? [])
      answerArea
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Theme.bg.ignoresSafeArea())
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
  }

  private var title: String {
    coordinator.sessions.first { $0.id == sessionId }?.displayName ?? "Session"
  }

  @ViewBuilder
  private var answerArea: some View {
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
}
