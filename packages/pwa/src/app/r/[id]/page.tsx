"use client";

import { AuroraBackground } from "@/components/AuroraBackground";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { CheckIcon, ToolIcon, XIcon } from "@/components/Icon";
import { RulePromoteModal } from "@/components/RulePromoteModal";
import { useQueue } from "@/lib/queue-context";
import { agentColor, tagHue } from "@/lib/tag-color";
import type { ApprovalRequest, PromoteRule } from "@vigili/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const TOOL_LABEL: Record<string, string> = {
  Bash: "Bash",
  Edit: "Edit",
  Write: "Write",
  WebFetch: "WebFetch",
};

const TOOL_SUMMARY: Record<string, string> = {
  Bash: "Run shell command",
  Edit: "Apply diff to source file",
  Write: "Create or replace file",
  WebFetch: "Fetch remote resource",
};

export default function DetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { byId, state, decide } = useQueue();
  const [showPromote, setShowPromote] = useState(false);
  const [, setTick] = useState(0);

  const id = params.id;
  const request = byId(id);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!request && state === "open") {
      const t = setTimeout(() => router.replace("/"), 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [request, state, router]);

  if (!request) {
    return (
      <main className="relative flex min-h-dvh flex-col text-(--color-fg)">
        <AuroraBackground />
        <DetailTopBar onBack={() => router.replace("/")} />
        <div className="relative z-10 flex flex-1 items-center justify-center px-6 text-center">
          <p className="label">
            {state === "connecting" ? "loading…" : "request already resolved"}
          </p>
        </div>
      </main>
    );
  }

  const ageSeconds = Math.floor((Date.now() - request.created_at) / 1000);
  const tag = request.session_tag ?? "untagged";
  const hue = tagHue(request.session_tag);

  const onDecide = (decision: "allow" | "deny"): void => {
    decide(request.id, decision);
    router.replace("/");
  };
  const onPromote = (promote: PromoteRule): void => {
    decide(request.id, "allow", promote);
    setShowPromote(false);
    router.replace("/");
  };

  return (
    <main className="relative flex min-h-dvh flex-col text-(--color-fg)">
      <AuroraBackground />

      <DetailTopBar
        onBack={() => router.replace("/")}
        ageSeconds={ageSeconds}
        requestId={request.id}
        state={state}
      />

      {/* Body */}
      <section className="safe-px relative z-10 flex flex-1 justify-center overflow-y-auto px-6 pb-36 sm:px-10">
        <div className="flex w-full flex-col gap-4" style={{ maxWidth: 720, paddingTop: 28 }}>
          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className="font-mono inline-flex items-center justify-center text-white"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: agentColor(hue, 50, 55),
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {(tag[0] ?? "?").toUpperCase()}
            </span>
            <span className="font-mono text-(--color-fg)" style={{ fontSize: 13 }}>
              {tag}
            </span>
            <span className="a-chip">
              <ToolIcon tool={request.tool_name} size={11} />
              {TOOL_LABEL[request.tool_name] ?? request.tool_name}
            </span>
          </div>

          {/* Summary */}
          <h1
            className="font-display"
            style={{
              fontSize: 22,
              color: "var(--color-fg)",
              fontWeight: 500,
              letterSpacing: "-0.01em",
              marginTop: 4,
            }}
          >
            {TOOL_SUMMARY[request.tool_name] ?? "Tool call"}
          </h1>

          {/* Command / body */}
          <CommandBlock request={request} />

          {/* Context */}
          <ContextBlock request={request} />
        </div>
      </section>

      {/* Action bar — sticky bottom */}
      <footer
        className="safe-px safe-pb sticky bottom-0 z-10 px-6 py-4 sm:px-10"
        style={{
          background:
            "linear-gradient(180deg, transparent, rgba(38,38,36,0.95) 30%, var(--color-bg) 75%)",
        }}
      >
        <div className="mx-auto flex flex-col gap-2.5" style={{ maxWidth: 720 }}>
          <button
            type="button"
            onClick={() => setShowPromote(true)}
            className="a-btn-ghost w-full"
            style={{
              borderColor: "rgba(123,174,137,0.4)",
              color: "var(--color-green-soft)",
            }}
          >
            <CheckIcon size={14} strokeWidth={1.8} />
            Allow & remember as rule
          </button>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" onClick={() => onDecide("deny")} className="a-btn-ghost">
              <XIcon size={14} strokeWidth={1.8} />
              Deny
            </button>
            <button type="button" onClick={() => onDecide("allow")} className="a-btn-primary">
              <CheckIcon size={14} strokeWidth={1.8} />
              Allow
            </button>
          </div>
        </div>
      </footer>

      {showPromote ? (
        <RulePromoteModal
          request={request}
          onCancel={() => setShowPromote(false)}
          onConfirm={onPromote}
        />
      ) : null}
    </main>
  );
}

function DetailTopBar({
  onBack,
  ageSeconds,
  requestId,
  state,
}: {
  onBack: () => void;
  ageSeconds?: number;
  requestId?: string;
  state?: import("@/lib/ws-client").ConnectionState;
}) {
  return (
    <div
      className="safe-px safe-pt relative z-10 flex items-center justify-between gap-3 px-6 py-5 sm:px-9 sm:py-6"
      style={{ borderBottom: "1px solid var(--color-border)" }}
    >
      <div className="flex min-w-0 items-center gap-4">
        <button type="button" onClick={onBack} className="a-btn-quiet">
          ← Queue
        </button>
        {requestId ? (
          <span
            className="font-mono truncate"
            style={{
              fontSize: 11,
              color: "var(--color-fg-dim)",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            request · {requestId.slice(0, 8)}
          </span>
        ) : null}
      </div>
      {ageSeconds !== undefined ? (
        <ConnectionStatus state={state ?? "open"} label={`holding · ${ageSeconds}s`} />
      ) : null}
    </div>
  );
}

function CommandBlock({ request }: { request: ApprovalRequest }) {
  if (request.tool_name === "Bash") {
    const cmd = stringField(request.tool_input, "command") ?? "(no command)";
    return (
      <Card title="Command · bash">
        <pre
          className="font-mono whitespace-pre-wrap break-all"
          style={{ fontSize: 12.5, lineHeight: 1.7 }}
        >
          <span style={{ color: "var(--color-accent-soft)" }}>$ </span>
          {cmd}
        </pre>
      </Card>
    );
  }
  if (request.tool_name === "Edit") {
    const path = stringField(request.tool_input, "file_path") ?? "(no path)";
    const oldS = stringField(request.tool_input, "old_string") ?? "";
    const newS = stringField(request.tool_input, "new_string") ?? "";
    return (
      <>
        <Card title="File">
          <p className="font-mono break-all" style={{ fontSize: 13 }}>
            {path}
          </p>
        </Card>
        <Card title="− Before" tone="deny">
          <Diff value={oldS} />
        </Card>
        <Card title="+ After" tone="allow">
          <Diff value={newS} />
        </Card>
      </>
    );
  }
  if (request.tool_name === "Write") {
    const path = stringField(request.tool_input, "file_path") ?? "(no path)";
    const content = stringField(request.tool_input, "content") ?? "";
    return (
      <>
        <Card title="New file">
          <p className="font-mono break-all" style={{ fontSize: 13 }}>
            {path}
          </p>
        </Card>
        <Card title="Content" tone="allow">
          <Diff value={content} />
        </Card>
      </>
    );
  }
  if (request.tool_name === "WebFetch") {
    const url = stringField(request.tool_input, "url") ?? "";
    const prompt = stringField(request.tool_input, "prompt") ?? "";
    return (
      <>
        <Card title="URL">
          <p className="font-mono break-all" style={{ fontSize: 13 }}>
            {url}
          </p>
        </Card>
        {prompt ? (
          <Card title="Prompt">
            <p className="whitespace-pre-wrap" style={{ fontSize: 13 }}>
              {prompt}
            </p>
          </Card>
        ) : null}
      </>
    );
  }
  return (
    <Card title="Payload">
      <pre className="font-mono whitespace-pre-wrap break-all" style={{ fontSize: 12 }}>
        {JSON.stringify(request.tool_input, null, 2)}
      </pre>
    </Card>
  );
}

function Card({
  title,
  tone = "default",
  children,
}: {
  title: string;
  tone?: "default" | "allow" | "deny";
  children: React.ReactNode;
}) {
  const labelColor =
    tone === "allow"
      ? "var(--color-green-soft)"
      : tone === "deny"
        ? "var(--color-red-soft)"
        : "var(--color-fg-dim)";
  return (
    <div className="a-surface overflow-hidden">
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span
          className="font-mono"
          style={{
            color: labelColor,
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          {title}
        </span>
      </div>
      <div
        style={{
          padding: "16px 18px",
          background: "var(--color-bg-code)",
          color: "rgba(250,247,242,0.85)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Diff({ value }: { value: string }) {
  return (
    <pre
      className="font-mono whitespace-pre-wrap break-all overflow-y-auto"
      style={{ fontSize: 12.5, lineHeight: 1.6, maxHeight: 240 }}
    >
      {value || "(empty)"}
    </pre>
  );
}

function ContextBlock({ request }: { request: ApprovalRequest }) {
  const created = new Date(request.created_at);
  return (
    <div className="a-surface" style={{ padding: 20 }}>
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          color: "var(--color-fg-dim)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          marginBottom: 12,
        }}
      >
        Context
      </div>
      <KV k="cwd" v={request.cwd} mono />
      <KV k="session" v={request.session_id} mono />
      <KV k="created" v={created.toLocaleString()} />
      <KV k="request id" v={request.id} mono />
    </div>
  );
}

function KV({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div
      className="grid items-baseline"
      style={{
        gridTemplateColumns: "90px 1fr",
        gap: 14,
        padding: "8px 0",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          color: "var(--color-fg-dim)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        {k}
      </div>
      <div
        className={mono ? "font-mono break-all" : "break-all"}
        style={{ fontSize: 12, color: "var(--color-fg)" }}
      >
        {v}
      </div>
    </div>
  );
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}
