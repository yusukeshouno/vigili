"use client";

import type { Message } from "@vigili/shared";
import { useEffect, useMemo, useState } from "react";
import { useQueue } from "@/lib/queue-context";

/**
 * 人間 → Claude メッセージ composer。
 *
 * 仕組み:
 * - ターゲット session_id は現在の pending と過去 messages から重複なく集めて選択肢にする
 * - 「送信」を押すと WS send-message が daemon に届き、daemon は messages テーブルに insert
 * - その session の gate が次に発火した時点で additionalContext として Claude に届く
 * - delivered_at が set されると ✓ delivered 表示に切り替わる
 */
export function MessageComposer() {
  const { pending, messages, sendMessage, state } = useQueue();

  // 候補 session_id: 現 pending の session_id を最優先、その後 messages 履歴
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of pending) {
      const sid = r.session_id ?? "";
      if (sid && !seen.has(sid)) {
        seen.add(sid);
        out.push(sid);
      }
    }
    for (const m of messages) {
      if (!seen.has(m.session_id)) {
        seen.add(m.session_id);
        out.push(m.session_id);
      }
    }
    return out;
  }, [pending, messages]);

  const [selectedSession, setSelectedSession] = useState<string>("");
  const [body, setBody] = useState("");

  // 候補が増えたら初期選択を入れる (まだ未選択の時のみ)
  useEffect(() => {
    if (!selectedSession && candidates[0]) {
      setSelectedSession(candidates[0]);
    }
  }, [candidates, selectedSession]);

  const recentForSession = useMemo(
    () => messages.filter((m) => m.session_id === selectedSession).slice(0, 5),
    [messages, selectedSession],
  );

  const canSend =
    state === "open" && selectedSession.length > 0 && body.trim().length > 0;

  const handleSend = (): void => {
    if (!canSend) return;
    sendMessage(selectedSession, body);
    setBody("");
  };

  return (
    <div
      className="rounded-2xl border px-4 py-4"
      style={{
        background: "var(--color-bg-rise)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span
          className="label"
          style={{
            fontSize: 10,
            color: "var(--color-fg-mid)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
          }}
        >
          message → Claude
        </span>
        {candidates.length === 0 ? (
          <span className="text-xs text-(--color-fg-dim)">no active session</span>
        ) : null}
      </div>

      {candidates.length === 0 ? (
        <p className="text-sm text-(--color-fg-dim)">
          セッションが見つかりません。Claude Code で何か操作すると、その session が
          ここに表示されます。
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-(--color-fg-mid)">target session</span>
            <select
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
              className="rounded-md border bg-(--color-bg) px-2 py-1.5 font-mono text-xs"
              style={{ borderColor: "var(--color-border)" }}
            >
              {candidates.map((sid) => (
                <option key={sid} value={sid}>
                  {shortSession(sid)}
                </option>
              ))}
            </select>
          </label>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Claude にひとこと… (Cmd+Enter で送信)"
            rows={2}
            maxLength={2000}
            className="resize-y rounded-md border bg-(--color-bg) px-3 py-2 text-sm"
            style={{ borderColor: "var(--color-border)", minHeight: 56 }}
          />

          <div className="flex items-center justify-between">
            <span
              className="font-mono text-xs"
              style={{
                color:
                  body.length > 1800 ? "var(--color-accent)" : "var(--color-fg-dim)",
              }}
            >
              {body.length}/2000
            </span>
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className="press rounded-md px-3 py-1.5 text-sm font-semibold"
              style={{
                background: canSend ? "var(--color-accent)" : "var(--color-bg)",
                color: canSend ? "var(--color-on-accent, #1b1816)" : "var(--color-fg-dim)",
                borderColor: "var(--color-border)",
                border: "1px solid var(--color-border)",
                cursor: canSend ? "pointer" : "not-allowed",
              }}
            >
              send
            </button>
          </div>

          {recentForSession.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {recentForSession.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  const delivered = message.delivered_at !== null;
  return (
    <li
      className="flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs"
      style={{
        background: "var(--color-bg)",
        borderColor: "var(--color-border)",
      }}
    >
      <span
        title={delivered ? "delivered to Claude" : "waiting for next tool use"}
        className="mt-0.5 inline-block size-1.5 rounded-full"
        style={{
          background: delivered ? "var(--color-accent)" : "var(--color-fg-dim)",
        }}
      />
      <span className="flex-1 break-words whitespace-pre-wrap text-(--color-fg)">
        {message.body}
      </span>
      <span className="font-mono text-(--color-fg-dim)" style={{ fontSize: 10 }}>
        {delivered ? "delivered" : "queued"}
      </span>
    </li>
  );
}

function shortSession(sid: string): string {
  if (sid.length <= 12) return sid;
  return `${sid.slice(0, 8)}…${sid.slice(-4)}`;
}
