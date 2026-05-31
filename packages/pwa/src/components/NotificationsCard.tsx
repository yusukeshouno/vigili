"use client";

import { ArrowRightIcon, BellIcon } from "@/components/Icon";
import { type PushStatus, disableNativePush, enableNativePush, getPushStatus } from "@/lib/push";
import { useCallback, useEffect, useState } from "react";

/**
 * 設定画面に表示する「Native notifications」カード。
 *
 * - 端末が PWA 非対応なら無効状態を出す
 * - iOS で standalone でない場合は「ホーム画面に追加」を案内
 * - 権限が default の場合は「Enable」ボタン
 * - 既に subscribe 済みなら「Disable」と endpoint プレビュー
 */
export function NotificationsCard() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await getPushStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onEnable = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const endpoint = await enableNativePush();
      setInfo(`Subscribed: ${shortEndpoint(endpoint)}`);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDisable = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const ok = await disableNativePush();
      setInfo(ok ? "Unsubscribed" : "No subscription to remove");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <div className="a-surface w-full" style={{ maxWidth: 480, padding: 24, marginTop: 16 }}>
        <p className="label" style={{ fontSize: 11 }}>
          loading…
        </p>
      </div>
    );
  }

  return (
    <div className="a-surface w-full" style={{ maxWidth: 480, padding: 24, marginTop: 16 }}>
      <div className="mb-3 flex items-center gap-2" style={{ color: "var(--color-fg)" }}>
        <BellIcon size={14} />
        <span style={{ fontSize: 13, fontWeight: 500 }}>Native notifications</span>
        <StatusPill status={status} />
      </div>

      <p className="mb-4" style={{ fontSize: 12, color: "var(--color-fg-dim)", lineHeight: 1.55 }}>
        Vigili から直接スマホに push 通知を飛ばします (ntfy などの中継不要)。 タップで該当 request
        の Detail 画面に飛びます。
      </p>

      {!status.supported ? (
        <Hint kind="warn">
          このブラウザは Web Push 非対応です (Safari/Chrome/Firefox の比較的新しい版が必要)
        </Hint>
      ) : status.needsHomeScreen ? (
        <Hint kind="warn">
          iOS では <strong>共有 → ホーム画面に追加</strong> してから、追加された PWA から
          このページを開いて enable してください。Safari タブ内では受信できません。
        </Hint>
      ) : null}

      {status.subscribed && status.endpoint ? (
        <Hint kind="ok">Subscribed · {shortEndpoint(status.endpoint)}</Hint>
      ) : null}

      {error ? <Hint kind="error">{error}</Hint> : null}
      {info && !error ? <Hint kind="ok">{info}</Hint> : null}

      <div className="mt-4 flex gap-2">
        {status.subscribed ? (
          <button
            type="button"
            onClick={() => void onDisable()}
            disabled={busy}
            className="a-btn-quiet"
          >
            {busy ? "…" : "Disable"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void onEnable()}
            disabled={busy || !status.supported || status.needsHomeScreen}
            className="a-btn-primary"
          >
            {busy ? "Enabling…" : "Enable"}
            <ArrowRightIcon size={14} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: PushStatus }) {
  let label = "off";
  let color = "var(--color-fg-dim)";
  if (!status.supported) {
    label = "unsupported";
  } else if (status.needsHomeScreen) {
    label = "add to home";
    color = "var(--color-amber-soft, #C8A06A)";
  } else if (status.subscribed) {
    label = "on";
    color = "var(--color-accent, #7AB67A)";
  } else if (status.permission === "denied") {
    label = "blocked";
    color = "var(--color-red-soft)";
  }
  return (
    <span
      className="font-mono"
      style={{
        marginLeft: "auto",
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color,
        padding: "2px 8px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        background: "transparent",
      }}
    >
      {label}
    </span>
  );
}

function Hint({ kind, children }: { kind: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const palette = {
    ok: {
      bg: "rgba(122,182,122,0.08)",
      border: "rgba(122,182,122,0.3)",
      fg: "var(--color-fg-mid)",
    },
    warn: {
      bg: "rgba(200,160,106,0.08)",
      border: "rgba(200,160,106,0.3)",
      fg: "var(--color-fg-mid)",
    },
    error: {
      bg: "rgba(214,118,108,0.08)",
      border: "rgba(214,118,108,0.3)",
      fg: "var(--color-red-soft)",
    },
  }[kind];
  return (
    <p
      className="font-mono mb-2 rounded-md px-3 py-2"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.fg,
        fontSize: 11,
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  );
}

function shortEndpoint(endpoint: string): string {
  try {
    const u = new URL(endpoint);
    const tail = u.pathname.slice(-12);
    return `${u.host}…${tail}`;
  } catch {
    return endpoint.length > 40 ? `…${endpoint.slice(-40)}` : endpoint;
  }
}
