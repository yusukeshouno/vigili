import SwiftUI

/// メニューバーポップオーバーに置く composer。
///
/// - 上に session_id ドロップダウン (pending + 過去 messages の session を集めて表示)
/// - その下に TextField + 送信ボタン (Cmd+Enter でも送れる)
/// - 下に直近 3 件の history (delivered/queued バッジ付き)
struct MessageComposerView: View {
  @EnvironmentObject private var coordinator: AppCoordinator
  @State private var selectedSession: String = ""
  @State private var text: String = ""
  @FocusState private var textFocused: Bool

  /// 候補 session_id (pending 優先、過去 messages 追加、重複排除)。
  private var candidates: [String] {
    var seen = Set<String>()
    var out: [String] = []
    for r in coordinator.pending {
      let sid = r.sessionId
      if !sid.isEmpty, !seen.contains(sid) {
        seen.insert(sid)
        out.append(sid)
      }
    }
    for m in coordinator.messages where !seen.contains(m.sessionId) {
      seen.insert(m.sessionId)
      out.append(m.sessionId)
    }
    return out
  }

  /// 選択中 session の直近 3 件。
  private var recent: [Message] {
    coordinator.messages
      .filter { $0.sessionId == selectedSession }
      .prefix(3)
      .map { $0 }
  }

  private var canSend: Bool {
    !selectedSession.isEmpty
      && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && (coordinator.wsState == .connected)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .firstTextBaseline) {
        Text("MESSAGE → CLAUDE")
          .font(.mono(9, weight: .semibold))
          .tracking(2.5)
          .foregroundStyle(Theme.fgMid)
        Spacer()
        if candidates.isEmpty {
          Text("no active session")
            .font(.system(size: 10))
            .foregroundStyle(Theme.fgDim)
        }
      }

      if candidates.isEmpty {
        Text("セッションが見つかりません。Claude Code で何か操作すると、ここに表示されます。")
          .font(.system(size: 11))
          .foregroundStyle(Theme.fgDim)
          .fixedSize(horizontal: false, vertical: true)
      } else {
        Picker("session", selection: $selectedSession) {
          ForEach(candidates, id: \.self) { sid in
            Text(shortSession(sid))
              .font(.system(.caption, design: .monospaced))
              .tag(sid)
          }
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .onAppear {
          if selectedSession.isEmpty, let first = candidates.first {
            selectedSession = first
          }
        }
        .onChange(of: coordinator.pending) { _ in
          if selectedSession.isEmpty || !candidates.contains(selectedSession) {
            selectedSession = candidates.first ?? ""
          }
        }

        HStack(alignment: .bottom, spacing: 6) {
          TextField("Claude にひとこと… (⌘↩ で送信)", text: $text, axis: .vertical)
            .lineLimit(1...4)
            .textFieldStyle(.plain)
            .font(.system(size: 12))
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(Theme.bg, in: RoundedRectangle(cornerRadius: 6))
            .overlay(
              RoundedRectangle(cornerRadius: 6).stroke(Theme.border, lineWidth: 1)
            )
            .focused($textFocused)
            .onSubmit(handleSend)

          Button(action: handleSend) {
            Text("send")
              .font(.display(11, weight: .semibold))
              .foregroundStyle(canSend ? Color.black.opacity(0.85) : Theme.fgDim)
              .padding(.horizontal, 12)
              .padding(.vertical, 7)
              .background(
                Capsule().fill(canSend ? Theme.accent : Theme.bg)
              )
              .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
          }
          .buttonStyle(.plain)
          .disabled(!canSend)
          .keyboardShortcut(.return, modifiers: .command)
        }

        if !recent.isEmpty {
          VStack(alignment: .leading, spacing: 3) {
            ForEach(recent) { m in
              MessageRowView(message: m)
            }
          }
          .padding(.top, 2)
        }
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 10)
    .background(Theme.bgRise, in: RoundedRectangle(cornerRadius: 10))
    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Theme.border, lineWidth: 1))
  }

  private func handleSend() {
    guard canSend else { return }
    coordinator.sendMessage(sessionId: selectedSession, body: text)
    text = ""
    textFocused = true
  }
}

private struct MessageRowView: View {
  let message: Message

  var body: some View {
    HStack(alignment: .top, spacing: 6) {
      Circle()
        .fill(message.isDelivered ? Theme.accent : Theme.fgDim)
        .frame(width: 5, height: 5)
        .padding(.top, 5)
      Text(message.body)
        .font(.system(size: 11))
        .foregroundStyle(Theme.fg)
        .lineLimit(2)
        .truncationMode(.tail)
        .frame(maxWidth: .infinity, alignment: .leading)
      Text(message.isDelivered ? "delivered" : "queued")
        .font(.system(size: 9, design: .monospaced))
        .foregroundStyle(Theme.fgDim)
    }
    .padding(.horizontal, 6)
    .padding(.vertical, 4)
    .background(Theme.bg, in: RoundedRectangle(cornerRadius: 5))
  }
}

private func shortSession(_ sid: String) -> String {
  if sid.count <= 12 { return sid }
  let prefix = sid.prefix(8)
  let suffix = sid.suffix(4)
  return "\(prefix)…\(suffix)"
}
