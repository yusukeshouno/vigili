"use client";

import { useQueue } from "@/lib/queue-context";
import Link from "next/link";

export default function SessionsPage() {
  const { sessions, pendingQuestions, pendingPlans } = useQueue();
  const sorted = [...sessions].sort((a, b) => b.started_at - a.started_at);
  const needs = (id: string) =>
    pendingQuestions.some((q) => q.session_id === id) ||
    pendingPlans.some((p) => p.session_id === id);

  return (
    <main className="relative flex min-h-dvh flex-col text-(--color-fg)">
      <div
        className="safe-px safe-pt flex items-center gap-3 px-6 py-5"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <Link
          href="/"
          aria-label="戻る"
          className="press text-(--color-fg-mid) hover:text-(--color-fg)"
        >
          ←
        </Link>
        <span className="text-lg" style={{ fontFamily: "var(--font-display)" }}>
          Sessions
        </span>
      </div>

      <section className="safe-px flex-1 px-6 py-5">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-20 text-center">
            <p className="label">no active sessions</p>
            <p className="font-mono text-xs text-(--color-fg-dim)">
              Mac で <code>vigili run</code> を実行すると会話がここに流れます
            </p>
          </div>
        ) : (
          <div className="mx-auto flex w-full flex-col gap-2.5" style={{ maxWidth: 560 }}>
            {sorted.map((s) => (
              <Link
                key={s.session_id}
                href={`/sessions/${encodeURIComponent(s.session_id)}`}
                className="a-surface press flex items-center gap-3 p-4"
              >
                <span style={{ color: statusColor(s.status) }}>●</span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{s.tag || lastPath(s.cwd)}</span>
                  <span className="truncate font-mono text-xs text-(--color-fg-dim)">{s.cwd}</span>
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {needs(s.session_id) ? (
                    <span className="a-chip" style={{ color: "var(--color-accent)" }}>
                      要回答
                    </span>
                  ) : null}
                  <span className="text-(--color-fg-dim)">›</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function statusColor(status: string): string {
  if (status === "awaiting") return "var(--color-accent)";
  if (status === "running") return "var(--color-green)";
  return "var(--color-fg-dim)";
}

function lastPath(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
