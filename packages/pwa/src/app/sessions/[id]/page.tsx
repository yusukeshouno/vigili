"use client";

import {
  PlanAnswer,
  QuestionAnswer,
  ReplyComposer,
  TranscriptBubble,
} from "@/components/SessionViews";
import { useQueue } from "@/lib/queue-context";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef } from "react";

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const {
    sessions,
    transcripts,
    pendingQuestions,
    pendingPlans,
    answerQuestion,
    decidePlan,
    sendReply,
  } = useQueue();

  const session = sessions.find((s) => s.session_id === id) ?? null;
  const lines = transcripts[id] ?? [];
  const question = pendingQuestions.find((x) => x.session_id === id) ?? null;
  const plan = pendingPlans.find((x) => x.session_id === id) ?? null;

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  return (
    <main className="flex min-h-dvh flex-col text-(--color-fg)">
      <div
        className="safe-px safe-pt flex items-center gap-3 px-5 py-4"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <Link
          href="/sessions"
          aria-label="戻る"
          className="press text-(--color-fg-mid) hover:text-(--color-fg)"
        >
          ←
        </Link>
        <span className="truncate text-sm font-medium">{session ? session.tag || id : id}</span>
        <span className="label ml-auto text-(--color-fg-dim)">
          {session ? session.status : "ended"}
        </span>
      </div>

      <section className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex w-full flex-col gap-2.5" style={{ maxWidth: 640 }}>
          {lines.length === 0 ? (
            <p className="py-10 text-center font-mono text-xs text-(--color-fg-dim)">
              no messages yet
            </p>
          ) : (
            lines.map((line, i) => <TranscriptBubble key={`${line.at}-${i}`} line={line} />)
          )}
          <div ref={bottomRef} />
        </div>
      </section>

      <div className="safe-px mx-auto w-full" style={{ maxWidth: 640 }}>
        {question ? (
          <div className="px-4 pb-3">
            <QuestionAnswer
              pending={question}
              onAnswer={(answers) => answerQuestion(question.request_id, answers)}
            />
          </div>
        ) : null}
        {plan ? (
          <div className="px-4 pb-3">
            <PlanAnswer
              pending={plan}
              onDecide={(decision) => decidePlan(plan.request_id, decision)}
            />
          </div>
        ) : null}
        <ReplyComposer onSend={(body) => sendReply(id, body)} />
      </div>
    </main>
  );
}
