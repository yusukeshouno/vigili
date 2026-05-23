"use client";

import type { ConnectionState } from "@/lib/ws-client";

/**
 * Claude-style status indicator: small colored dot + uppercase mono label.
 * 接続中だけ a-dot のパルスが効く。
 */
interface Props {
  state: ConnectionState;
  detail?: string | undefined;
  label?: string | undefined;
}

const DEFAULT_LABELS: Record<ConnectionState, string> = {
  connecting: "connecting",
  open: "live",
  closed: "not connected",
  error: "offline",
};

const DOT_COLOR: Record<ConnectionState, string> = {
  connecting: "var(--color-amber)",
  open: "var(--color-green)",
  closed: "var(--color-fg-dim)",
  error: "var(--color-red)",
};

export function ConnectionStatus({ state, detail, label }: Props) {
  const live = state === "open";
  const text = label ?? DEFAULT_LABELS[state];
  const color = DOT_COLOR[state];
  return (
    <span
      title={detail}
      className="font-mono inline-flex items-center gap-2.5"
      style={{
        fontSize: 11,
        color: "var(--color-fg-mid)",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
      }}
    >
      <span
        className={live ? "a-dot" : ""}
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          color,
          flexShrink: 0,
        }}
      />
      {text}
    </span>
  );
}
