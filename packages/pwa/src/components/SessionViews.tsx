"use client";

import type { Question, TranscriptLine } from "@vigili/shared";
import { useState } from "react";
import type { PendingPlan, PendingQuestion } from "@/lib/queue-context";

/** transcript の 1 行 (吹き出し)。role で配置と色を変える。 */
export function TranscriptBubble({ line }: { line: TranscriptLine }) {
  if (line.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm"
          style={{ background: "var(--color-accent-dim, #84402c)", color: "var(--color-fg)" }}
        >
          {line.text}
        </div>
      </div>
    );
  }
  if (line.role === "tool") {
    return (
      <div className="flex flex-col gap-1">
        {line.tool_name ? <span className="label">{line.tool_name}</span> : null}
        <pre
          className="overflow-x-auto whitespace-pre-wrap rounded-lg p-2.5 font-mono text-xs"
          style={{ background: "var(--color-bg-code)", color: "var(--color-fg-mid)" }}
        >
          {line.text}
        </pre>
      </div>
    );
  }
  if (line.role === "system") {
    return (
      <div className="text-center font-mono text-xs" style={{ color: "var(--color-fg-dim)" }}>
        {line.text}
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div
        className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm"
        style={{ background: "var(--color-bg-rise)", color: "var(--color-fg)" }}
      >
        {line.text}
      </div>
    </div>
  );
}

/** AskUserQuestion の回答 UI。single-select は 1 つ / multiSelect は複数 → ", " 連結。 */
export function QuestionAnswer({
  pending,
  onAnswer,
}: {
  pending: PendingQuestion;
  onAnswer: (answers: Record<string, string>) => void;
}) {
  const [sel, setSel] = useState<Record<string, Set<string>>>({});

  const toggle = (q: Question, label: string) => {
    setSel((prev) => {
      const cur = new Set(prev[q.question] ?? []);
      if (q.multiSelect) {
        if (cur.has(label)) cur.delete(label);
        else cur.add(label);
      } else {
        cur.clear();
        cur.add(label);
      }
      return { ...prev, [q.question]: cur };
    });
  };

  const allAnswered = pending.questions.every((q) => (sel[q.question]?.size ?? 0) > 0);

  const submit = () => {
    if (!allAnswered) return;
    const answers: Record<string, string> = {};
    for (const q of pending.questions) {
      const labels = q.options.map((o) => o.label).filter((l) => sel[q.question]?.has(l));
      answers[q.question] = labels.join(", ");
    }
    onAnswer(answers);
  };

  return (
    <div className="a-surface-raised flex flex-col gap-3 p-4">
      <span className="label" style={{ color: "var(--color-accent)" }}>
        質問に回答
      </span>
      {pending.questions.map((q) => (
        <div key={q.question} className="flex flex-col gap-2">
          {q.header ? <span className="label">{q.header}</span> : null}
          <p className="text-sm font-medium" style={{ color: "var(--color-fg)" }}>
            {q.question}
          </p>
          {q.options.map((opt) => {
            const chosen = sel[q.question]?.has(opt.label) ?? false;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => toggle(q, opt.label)}
                className="press flex items-start gap-2 rounded-lg border p-2.5 text-left"
                style={{
                  borderColor: chosen ? "var(--color-accent)" : "var(--color-border)",
                  background: chosen
                    ? "color-mix(in srgb, var(--color-accent) 12%, transparent)"
                    : "var(--color-bg-rise)",
                }}
              >
                <span style={{ color: chosen ? "var(--color-accent)" : "var(--color-fg-dim)" }}>
                  {chosen ? "●" : "○"}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm" style={{ color: "var(--color-fg)" }}>
                    {opt.label}
                  </span>
                  {opt.description ? (
                    <span className="font-mono text-xs" style={{ color: "var(--color-fg-mid)" }}>
                      {opt.description}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ))}
      <button
        type="button"
        disabled={!allAnswered}
        onClick={submit}
        className="a-btn-primary disabled:opacity-40"
      >
        回答を送信
      </button>
    </div>
  );
}

/** ExitPlanMode の plan 承認 / 却下 UI。 */
export function PlanAnswer({
  pending,
  onDecide,
}: {
  pending: PendingPlan;
  onDecide: (decision: "approve" | "reject") => void;
}) {
  return (
    <div className="a-surface-raised flex flex-col gap-3 p-4">
      <span className="label" style={{ color: "var(--color-accent)" }}>
        Plan を承認
      </span>
      <pre
        className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg p-2.5 font-mono text-xs"
        style={{ background: "var(--color-bg-code)", color: "var(--color-fg-mid)" }}
      >
        {pending.plan}
      </pre>
      <div className="flex gap-2.5">
        <button type="button" onClick={() => onDecide("reject")} className="a-btn-ghost flex-1">
          却下
        </button>
        <button type="button" onClick={() => onDecide("approve")} className="a-btn-primary flex-1">
          承認
        </button>
      </div>
    </div>
  );
}

/** ホスト型セッションへの自由文返信 (次の user turn)。 */
export function ReplyComposer({ onSend }: { onSend: (body: string) => void }) {
  const [text, setText] = useState("");
  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  return (
    <div
      className="flex items-end gap-2 p-3"
      style={{ borderTop: "1px solid var(--color-border)" }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={1}
        placeholder="返信を入力…"
        className="a-input flex-1 resize-none"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <button
        type="button"
        onClick={send}
        disabled={!text.trim()}
        className="a-btn-primary disabled:opacity-40"
      >
        送信
      </button>
    </div>
  );
}
