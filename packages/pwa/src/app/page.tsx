"use client";

import { ApprovalCard } from "@/components/ApprovalCard";
import { AuroraBackground } from "@/components/AuroraBackground";
import { Brand, HandDrawnShield } from "@/components/Brand";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { SettingsIcon } from "@/components/Icon";
import { SwipeStack } from "@/components/SwipeStack";
import { useQueue } from "@/lib/queue-context";
import type { ConnectionState } from "@/lib/ws-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function QueuePage() {
  const router = useRouter();
  const { pending, state, stateDetail, needsSetup, decide } = useQueue();

  useEffect(() => {
    if (needsSetup) router.replace("/setup");
  }, [needsSetup, router]);

  const sorted = [...pending].sort((a, b) => b.created_at - a.created_at);
  const total = sorted.length;

  return (
    <main className="relative flex min-h-dvh flex-col text-(--color-fg)">
      <AuroraBackground />

      {/* Top bar */}
      <div
        className="safe-px safe-pt relative z-10 flex items-center justify-between gap-3 px-6 py-5 sm:px-9 sm:py-6"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <Brand />
        <div className="flex items-center gap-5">
          {total > 0 ? (
            <span
              className="font-mono"
              style={{
                fontSize: 11,
                color: "var(--color-fg-mid)",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
              }}
            >
              {total}
              <span className="ml-1.5 text-(--color-fg-dim)">pending</span>
            </span>
          ) : null}
          <ConnectionStatus state={state} detail={stateDetail} />
          <Link
            href="/setup"
            aria-label="設定"
            className="press inline-flex size-8 items-center justify-center rounded-full border border-(--color-border) text-(--color-fg-mid) hover:border-(--color-border-strong) hover:text-(--color-fg)"
          >
            <SettingsIcon size={14} />
          </Link>
        </div>
      </div>

      {/* Stack / Empty */}
      <section className="safe-px relative z-10 flex flex-1 items-center justify-center px-6 pb-28 sm:px-10">
        <div className="relative flex w-full flex-col gap-5" style={{ maxWidth: 560 }}>
          {total === 0 ? (
            <EmptyState state={state} />
          ) : (
            <SwipeStack
              items={sorted}
              height={Math.min(520, 380 + sorted.length * 18)}
              onDecide={(item, verdict) => decide(item.id, verdict)}
              onOpen={(item) => router.push(`/r/${item.id}`)}
              renderCard={(item, ctx) => <ApprovalCard request={item} progress={ctx.progress} />}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function EmptyState({ state }: { state: ConnectionState }) {
  if (state === "connecting") {
    return (
      <div className="flex flex-col items-center gap-5 py-20 text-center">
        <HandDrawnShield size={56} />
        <p className="label">connecting…</p>
      </div>
    );
  }
  if (state === "closed" || state === "error") {
    return (
      <div className="flex flex-col items-center gap-5 py-20 text-center">
        <HandDrawnShield size={56} color="var(--color-fg-dim)" />
        <p className="label">daemon unreachable</p>
        <Link href="/setup" className="a-btn-quiet">
          check connection
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-5 py-20 text-center">
      <div className="standing-watch-spin">
        <HandDrawnShield size={64} scale={1.6} />
      </div>
      <p className="label" style={{ letterSpacing: "0.22em" }}>
        standing watch
      </p>
    </div>
  );
}
