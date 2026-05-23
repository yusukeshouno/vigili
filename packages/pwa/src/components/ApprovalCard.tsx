"use client";

import { ToolIcon } from "@/components/Icon";
import { agentColor, tagHue } from "@/lib/tag-color";
import type { ApprovalRequest } from "@sentinel/shared";
import { useEffect, useState } from "react";

interface Props {
  request: ApprovalRequest;
  /** SwipeStack が渡す: -1 (deny) ... 0 ... 1 (allow) */
  progress?: number;
}

/**
 * Claude メッセージ風承認カード (フラット、warm dark)。
 * 構成:
 *  - header: avatar (agent hue) + tag + session id meta + tool chip
 *  - summary: tool に応じた要約 (18px Bricolage)
 *  - body: 監視対象 (command / path / url) を #1F1E1D の inner block で
 *  - footer: cwd (top border)
 */
export function ApprovalCard({ request, progress = 0 }: Props) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const tag = request.session_tag ?? "untagged";
  const hue = tagHue(request.session_tag);
  const tool = TOOL_META[request.tool_name] ?? { label: request.tool_name, summary: "Tool call" };
  const ageSeconds = Math.floor((Date.now() - request.created_at) / 1000);
  const verdict = progress > 0.4 ? "allow" : progress < -0.4 ? "deny" : null;
  const body = formatBody(request);

  return (
    <div
      className="a-surface-raised relative flex h-full flex-col overflow-hidden"
      style={{
        borderRadius: 16,
        background: "var(--color-bg-rise)",
      }}
    >
      {/* 判定アウトライン (allow=green / deny=red) — drag 中だけ */}
      {verdict ? (
        <div
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            inset: -1,
            borderRadius: 17,
            border: `1px solid ${
              verdict === "allow"
                ? `rgba(123,174,137,${0.4 + Math.abs(progress) * 0.5})`
                : `rgba(214,118,108,${0.4 + Math.abs(progress) * 0.5})`
            }`,
            transition: "border-color .15s",
          }}
        />
      ) : null}

      {/* Header */}
      <div className="flex items-center gap-3" style={{ padding: "18px 22px 12px" }}>
        <span
          className="font-mono inline-flex items-center justify-center text-white shrink-0"
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
        <div className="min-w-0 flex-1">
          <div className="font-mono truncate text-(--color-fg)" style={{ fontSize: 12.5 }}>
            {tag}
          </div>
          <div className="label mt-0.5 truncate" style={{ fontSize: 10, letterSpacing: "0.14em" }}>
            session · {request.session_id.slice(0, 12)} · {ageSeconds}s ago
          </div>
        </div>
        <span className="a-chip">
          <ToolIcon tool={request.tool_name} size={11} />
          {tool.label}
        </span>
      </div>

      {/* Summary */}
      <div
        className="font-display"
        style={{
          padding: "0 22px 12px",
          fontSize: 18,
          color: "var(--color-fg)",
          fontWeight: 500,
          letterSpacing: "-0.01em",
        }}
      >
        {tool.summary}
      </div>

      {/* Command body */}
      <div className="flex flex-1 min-h-0" style={{ padding: "0 22px 18px" }}>
        <div
          className="font-mono flex-1 overflow-hidden"
          style={{
            padding: "14px 16px",
            borderRadius: 10,
            background: "var(--color-bg-code)",
            border: "1px solid var(--color-border)",
            fontSize: 12.5,
            lineHeight: 1.65,
            color: "rgba(250,247,242,0.85)",
            wordBreak: "break-all",
            whiteSpace: "pre-wrap",
          }}
        >
          {request.tool_name === "Bash" ? (
            <>
              <span style={{ color: "var(--color-accent-soft)" }}>$ </span>
              {body}
            </>
          ) : (
            body
          )}
        </div>
      </div>

      {/* Footer cwd */}
      <div
        className="font-mono flex items-center gap-2 truncate"
        style={{
          padding: "10px 22px",
          borderTop: "1px solid var(--color-border)",
          fontSize: 10,
          color: "var(--color-fg-dim)",
          letterSpacing: "0.08em",
        }}
      >
        <FolderIcon size={11} />
        <span className="truncate">{request.cwd}</span>
      </div>
    </div>
  );
}

function FolderIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <title>folder</title>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

const TOOL_META: Record<string, { label: string; summary: string }> = {
  Bash: { label: "Bash", summary: "Run shell command" },
  Edit: { label: "Edit", summary: "Apply diff to source file" },
  Write: { label: "Write", summary: "Create or replace file" },
  WebFetch: { label: "WebFetch", summary: "Fetch remote resource" },
};

function formatBody(req: ApprovalRequest): string {
  if (req.tool_name === "Bash") {
    return stringField(req.tool_input, "command") ?? "(no command)";
  }
  if (req.tool_name === "Edit" || req.tool_name === "Write") {
    return (
      stringField(req.tool_input, "file_path") ?? stringField(req.tool_input, "path") ?? "(no path)"
    );
  }
  if (req.tool_name === "WebFetch") {
    return stringField(req.tool_input, "url") ?? "(no url)";
  }
  return JSON.stringify(req.tool_input, null, 2);
}

function stringField(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}
