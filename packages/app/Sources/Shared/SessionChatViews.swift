import SwiftUI

/// L4 ホスト型セッションの transcript / 回答 UI のうち、Mac と iOS で共用する部品。
///
/// コンテナ (ウィンドウ / NavigationStack) は各 OS 側に置き、中身のチャット吹き出し・
/// 質問回答・plan 承認・返信欄はここに集約する。Theme / Font ヘルパは Shared 共通。

// MARK: - transcript scroll

/// transcript のチャットスクロール。新規行が来たら最下部へ自動スクロール。
struct TranscriptScroll: View {
  let lines: [TranscriptLine]

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 10) {
          ForEach(lines) { line in
            TranscriptBubble(line: line).id(line.id)
          }
          Color.clear.frame(height: 1).id("bottom")
        }
        .padding(16)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .onChange(of: lines.count) { _ in
        withAnimation(.easeOut(duration: 0.2)) {
          proxy.scrollTo("bottom", anchor: .bottom)
        }
      }
      .onAppear {
        proxy.scrollTo("bottom", anchor: .bottom)
      }
    }
  }
}

/// transcript の 1 行 (吹き出し)。role で配置と色を変える。
struct TranscriptBubble: View {
  let line: TranscriptLine

  var body: some View {
    switch line.role {
    case "user":
      HStack {
        Spacer(minLength: 40)
        bubble(bg: Theme.accentDim.opacity(0.55), fg: Theme.fg, align: .trailing)
      }
    case "tool":
      VStack(alignment: .leading, spacing: 3) {
        if let name = line.toolName {
          Text(name)
            .monoLabel(9, weight: .medium)
            .foregroundStyle(Theme.accentSoft)
        }
        Text(line.text)
          .font(.mono(10))
          .foregroundStyle(Theme.fgMid)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(10)
          .background(RoundedRectangle(cornerRadius: 8).fill(Theme.bgCode))
      }
    case "system":
      Text(line.text)
        .font(.mono(9))
        .foregroundStyle(Theme.fgDim)
        .frame(maxWidth: .infinity, alignment: .center)
        .multilineTextAlignment(.center)
    default:  // assistant
      HStack {
        bubble(bg: Theme.bgRise, fg: Theme.fg, align: .leading)
        Spacer(minLength: 40)
      }
    }
  }

  private func bubble(bg: Color, fg: Color, align: HorizontalAlignment) -> some View {
    Text(line.text)
      .font(.display(12))
      .foregroundStyle(fg)
      .textSelection(.enabled)
      .multilineTextAlignment(align == .trailing ? .trailing : .leading)
      .padding(.horizontal, 12)
      .padding(.vertical, 9)
      .background(RoundedRectangle(cornerRadius: 12).fill(bg))
  }
}

// MARK: - question answer

/// AskUserQuestion の回答 UI。各質問に対し選択肢ボタンを並べる。
/// single-select は 1 つ選ぶ / multiSelect は複数トグル → ", " 連結で 1 文字列に。
/// 全質問が回答済みになったら Send で {<question>: <label(s)>} を返す。
struct QuestionAnswerView: View {
  let pending: PendingQuestion
  let onAnswer: ([String: String]) -> Void

  /// question テキスト → 選択 label 集合。
  @State private var selections: [String: Set<String>] = [:]

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Label("質問に回答", systemImage: "questionmark.bubble")
        .font(.display(12, weight: .semibold))
        .foregroundStyle(Theme.accent)

      ForEach(pending.questions) { q in
        VStack(alignment: .leading, spacing: 6) {
          if !q.header.isEmpty {
            Text(q.header).monoLabel(9).foregroundStyle(Theme.fgDim)
          }
          Text(q.question)
            .font(.display(12, weight: .medium))
            .foregroundStyle(Theme.fg)
          ForEach(q.options) { opt in
            optionButton(question: q, option: opt)
          }
        }
      }

      Button(action: send) {
        Text("回答を送信")
          .font(.mono(12, weight: .medium))
          .foregroundStyle(allAnswered ? Theme.bg : Theme.fgDim)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 10)
          .background(
            RoundedRectangle(cornerRadius: 10)
              .fill(allAnswered ? Theme.accent : Theme.bgRise2))
      }
      .buttonStyle(.plain)
      .disabled(!allAnswered)
    }
    .padding(16)
    .background(Theme.bgRise.opacity(0.5))
  }

  private func optionButton(question q: Question, option opt: QuestionOption) -> some View {
    let chosen = selections[q.question]?.contains(opt.label) ?? false
    return Button {
      toggle(question: q, label: opt.label)
    } label: {
      HStack(alignment: .top, spacing: 8) {
        Image(systemName: chosen ? "checkmark.circle.fill" : "circle")
          .font(.system(size: 13))
          .foregroundStyle(chosen ? Theme.accent : Theme.fgDim)
        VStack(alignment: .leading, spacing: 2) {
          Text(opt.label)
            .font(.display(12, weight: .medium))
            .foregroundStyle(Theme.fg)
          if !opt.description.isEmpty {
            Text(opt.description)
              .font(.mono(10))
              .foregroundStyle(Theme.fgMid)
              .multilineTextAlignment(.leading)
          }
        }
        Spacer(minLength: 0)
      }
      .padding(10)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(
        RoundedRectangle(cornerRadius: 9)
          .fill(chosen ? Theme.accent.opacity(0.12) : Theme.bgRise2)
          .overlay(
            RoundedRectangle(cornerRadius: 9)
              .stroke(chosen ? Theme.accent.opacity(0.5) : Theme.border, lineWidth: 1))
      )
      .contentShape(RoundedRectangle(cornerRadius: 9))
    }
    .buttonStyle(.plain)
  }

  private func toggle(question q: Question, label: String) {
    var set = selections[q.question] ?? []
    if q.multiSelect {
      if set.contains(label) { set.remove(label) } else { set.insert(label) }
    } else {
      set = [label]
    }
    selections[q.question] = set
  }

  private var allAnswered: Bool {
    pending.questions.allSatisfy { !(selections[$0.question]?.isEmpty ?? true) }
  }

  private func send() {
    guard allAnswered else { return }
    var answers: [String: String] = [:]
    for q in pending.questions {
      let labels = q.options.map(\.label).filter { selections[q.question]?.contains($0) ?? false }
      answers[q.question] = labels.joined(separator: ", ")
    }
    onAnswer(answers)
  }
}

// MARK: - plan answer

/// ExitPlanMode の plan 承認 / 却下 UI。
struct PlanAnswerView: View {
  let pending: PendingPlan
  let onDecide: (String) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Label("Plan を承認", systemImage: "checklist")
        .font(.display(12, weight: .semibold))
        .foregroundStyle(Theme.accent)

      ScrollView {
        Text(pending.plan)
          .font(.mono(11))
          .foregroundStyle(Theme.fgMid)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(10)
      }
      .frame(maxHeight: 160)
      .background(RoundedRectangle(cornerRadius: 8).fill(Theme.bgCode))

      HStack(spacing: 10) {
        Button {
          onDecide("reject")
        } label: {
          Text("却下")
            .font(.mono(12, weight: .medium))
            .foregroundStyle(Theme.fg)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(
              RoundedRectangle(cornerRadius: 10).stroke(Theme.borderStrong, lineWidth: 1))
        }
        .buttonStyle(.plain)
        Button {
          onDecide("approve")
        } label: {
          Text("承認")
            .font(.mono(12, weight: .medium))
            .foregroundStyle(Theme.bg)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 10)
            .background(RoundedRectangle(cornerRadius: 10).fill(Theme.accent))
        }
        .buttonStyle(.plain)
      }
    }
    .padding(16)
    .background(Theme.bgRise.opacity(0.5))
  }
}

// MARK: - reply composer

/// セッションへの自由文返信 (次の user turn)。
struct ReplyComposer: View {
  let onSend: (String) -> Void
  @State private var text: String = ""

  var body: some View {
    HStack(spacing: 8) {
      TextField("返信を入力…", text: $text, axis: .vertical)
        .textFieldStyle(.plain)
        .font(.display(12))
        .foregroundStyle(Theme.fg)
        .lineLimit(1...4)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 10).fill(Theme.bgRise2))
        .onSubmit(send)
      Button(action: send) {
        Image(systemName: "arrow.up.circle.fill")
          .font(.system(size: 22))
          .foregroundStyle(canSend ? Theme.accent : Theme.fgDim)
      }
      .buttonStyle(.plain)
      .disabled(!canSend)
    }
    .padding(12)
  }

  private var canSend: Bool {
    !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  private func send() {
    let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !body.isEmpty else { return }
    onSend(body)
    text = ""
  }
}
