import SwiftUI

/// iOS: 「Claude にひとこと」用の composer。
/// MobileQueueView の下端に置く。
struct MobileMessageComposerView: View {
  @EnvironmentObject private var coordinator: MobileAppCoordinator
  @State private var selectedSession: String = ""
  @State private var text: String = ""
  @FocusState private var textFocused: Bool

  private var candidates: [String] {
    var seen = Set<String>()
    var out: [String] = []
    for r in coordinator.pending where !seen.contains(r.sessionId) {
      seen.insert(r.sessionId)
      out.append(r.sessionId)
    }
    for m in coordinator.messages where !seen.contains(m.sessionId) {
      seen.insert(m.sessionId)
      out.append(m.sessionId)
    }
    return out
  }

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
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        Text("MESSAGE → CLAUDE")
          .font(.mono(10, weight: .semibold))
          .tracking(2.5)
          .foregroundStyle(Theme.fgMid)
        Spacer()
        if candidates.isEmpty {
          Text("no active session")
            .font(.system(size: 11))
            .foregroundStyle(Theme.fgDim)
        }
      }

      if candidates.isEmpty {
        Text("Claude Code で何か操作すると、そのセッションが選べるようになります。")
          .font(.system(size: 12))
          .foregroundStyle(Theme.fgDim)
          .fixedSize(horizontal: false, vertical: true)
      } else {
        Menu {
          ForEach(candidates, id: \.self) { sid in
            Button(shortSession(sid)) { selectedSession = sid }
          }
        } label: {
          HStack(spacing: 6) {
            Text(selectedSession.isEmpty ? "select session" : shortSession(selectedSession))
              .font(.system(.caption, design: .monospaced))
              .foregroundStyle(Theme.fg)
            Image(systemName: "chevron.down")
              .font(.system(size: 9, weight: .semibold))
              .foregroundStyle(Theme.fgDim)
          }
          .padding(.horizontal, 10)
          .padding(.vertical, 6)
          .background(Theme.bg, in: Capsule())
          .overlay(Capsule().stroke(Theme.border, lineWidth: 1))
        }
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

        HStack(alignment: .bottom, spacing: 8) {
          TextField("Claude にひとこと…", text: $text, axis: .vertical)
            .lineLimit(1...4)
            .textFieldStyle(.plain)
            .font(.system(size: 14))
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(Theme.bg, in: RoundedRectangle(cornerRadius: 8))
            .overlay(
              RoundedRectangle(cornerRadius: 8).stroke(Theme.border, lineWidth: 1)
            )
            .focused($textFocused)
            .submitLabel(.send)
            .onSubmit(handleSend)

          Button(action: handleSend) {
            Image(systemName: "paperplane.fill")
              .font(.system(size: 14, weight: .semibold))
              .foregroundStyle(canSend ? Color.black.opacity(0.85) : Theme.fgDim)
              .frame(width: 38, height: 38)
              .background(Circle().fill(canSend ? Theme.accent : Theme.bg))
              .overlay(Circle().stroke(Theme.border, lineWidth: 1))
          }
          .disabled(!canSend)
        }

        if !recent.isEmpty {
          VStack(alignment: .leading, spacing: 4) {
            ForEach(recent) { m in
              MobileMessageRowView(message: m)
            }
          }
        }
      }
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 12)
    .background(Theme.bgRise, in: RoundedRectangle(cornerRadius: 14))
    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Theme.border, lineWidth: 1))
  }

  private func handleSend() {
    guard canSend else { return }
    coordinator.sendMessage(sessionId: selectedSession, body: text)
    text = ""
  }
}

private struct MobileMessageRowView: View {
  let message: Message

  var body: some View {
    HStack(alignment: .top, spacing: 8) {
      Circle()
        .fill(message.isDelivered ? Theme.accent : Theme.fgDim)
        .frame(width: 6, height: 6)
        .padding(.top, 6)
      Text(message.body)
        .font(.system(size: 12))
        .foregroundStyle(Theme.fg)
        .lineLimit(2)
        .truncationMode(.tail)
        .frame(maxWidth: .infinity, alignment: .leading)
      Text(message.isDelivered ? "delivered" : "queued")
        .font(.system(size: 10, design: .monospaced))
        .foregroundStyle(Theme.fgDim)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 5)
    .background(Theme.bg, in: RoundedRectangle(cornerRadius: 7))
  }
}

private func shortSession(_ sid: String) -> String {
  if sid.count <= 12 { return sid }
  let prefix = sid.prefix(8)
  let suffix = sid.suffix(4)
  return "\(prefix)…\(suffix)"
}
