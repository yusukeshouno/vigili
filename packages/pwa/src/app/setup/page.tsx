"use client";

import { AuroraBackground } from "@/components/AuroraBackground";
import { Brand } from "@/components/Brand";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import { ArrowRightIcon, EyeIcon, EyeOffIcon, ShieldIcon } from "@/components/Icon";
import { NotificationsCard } from "@/components/NotificationsCard";
import { type PwaConfig, loadConfig, saveConfig } from "@/lib/config-store";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

export default function SetupPage() {
  const [daemonUrl, setDaemonUrl] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasExisting, setHasExisting] = useState(false);

  useEffect(() => {
    void (async () => {
      const cfg = await loadConfig();
      if (cfg) {
        setDaemonUrl(cfg.daemonUrl);
        setToken(cfg.token);
        setHasExisting(true);
      } else if (typeof window !== "undefined" && window.location.hostname === "localhost") {
        setDaemonUrl("http://localhost:7878");
      }
    })();
  }, []);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      new URL(daemonUrl);
      const cfg: PwaConfig = { daemonUrl: daemonUrl.trim(), token: token.trim() };
      await saveConfig(cfg);
      window.location.assign("/");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh flex-col text-(--color-fg)">
      <AuroraBackground />

      {/* Top bar */}
      <div
        className="safe-px safe-pt relative z-10 flex items-center justify-between gap-3 px-6 py-5 sm:px-9 sm:py-6"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <Brand />
        <ConnectionStatus state="closed" label={hasExisting ? "reconnect" : "not connected"} />
      </div>

      {/* Form */}
      <div className="safe-px safe-pb relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-12 sm:px-10">
        <form onSubmit={submit} className="a-surface w-full" style={{ maxWidth: 480, padding: 32 }}>
          <Field label="Daemon URL" hint={hintForUrl(daemonUrl)}>
            <div className="a-input flex items-center" style={{ padding: "12px 14px" }}>
              <NetworkIcon size={14} className="mr-2.5 text-(--color-fg-mid)" />
              <input
                type="url"
                required
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="http://localhost:7878"
                value={daemonUrl}
                onChange={(e) => setDaemonUrl(e.target.value)}
                className="font-mono w-full bg-transparent outline-none placeholder:text-(--color-fg-dim)"
                style={{ color: "var(--color-fg)", fontSize: 13 }}
              />
            </div>
          </Field>

          <Field
            label="Access token"
            hint={
              <>
                From{" "}
                <code
                  className="font-mono"
                  style={{
                    background: "rgba(250,247,242,0.05)",
                    padding: "2px 6px",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                >
                  cat ~/.sentinel/token
                </code>
              </>
            }
          >
            <div className="a-input flex items-center" style={{ padding: "12px 14px" }}>
              <ShieldIcon size={14} className="mr-2.5 text-(--color-fg-mid)" />
              <input
                type={showToken ? "text" : "password"}
                required
                autoComplete="off"
                placeholder="64 hex chars"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="font-mono w-full bg-transparent outline-none placeholder:text-(--color-fg-dim)"
                style={{ color: "var(--color-fg)", fontSize: 12.5, letterSpacing: "0.04em" }}
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                aria-label={showToken ? "Hide" : "Show"}
                className="press ml-1 inline-flex size-7 items-center justify-center text-(--color-fg-mid) hover:text-(--color-fg)"
              >
                {showToken ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
              </button>
            </div>
          </Field>

          {error ? (
            <p
              role="alert"
              className="font-mono mb-3 rounded-md px-3 py-2"
              style={{
                background: "rgba(214,118,108,0.08)",
                border: "1px solid rgba(214,118,108,0.3)",
                color: "var(--color-red-soft)",
                fontSize: 12,
              }}
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy || !daemonUrl || !token}
            className="a-btn-primary mt-3 w-full"
          >
            {busy ? "Saving…" : hasExisting ? "Reconnect" : "Connect"}
            <ArrowRightIcon size={14} strokeWidth={1.8} />
          </button>

          <p className="label mt-5 text-center" style={{ fontSize: 10 }}>
            token stored only in this device · IndexedDB
          </p>
        </form>

        {hasExisting ? <NotificationsCard /> : null}
      </div>
    </main>
  );
}

function Field({
  label,
  hint,
  children,
}: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="mb-2" style={{ fontSize: 12, color: "var(--color-fg-mid)", fontWeight: 500 }}>
        {label}
      </div>
      {children}
      {hint ? (
        <div style={{ fontSize: 11, color: "var(--color-fg-dim)", marginTop: 7 }}>{hint}</div>
      ) : null}
    </div>
  );
}

function hintForUrl(url: string): ReactNode {
  if (!url) return "Tailscale Funnel 経由なら https://… の URL";
  try {
    const u = new URL(url);
    const isSecure = u.protocol === "https:";
    return (
      <>
        WebSocket:{" "}
        <code
          className="font-mono"
          style={{
            background: "rgba(250,247,242,0.05)",
            padding: "2px 6px",
            borderRadius: 4,
            fontSize: 11,
          }}
        >
          {isSecure ? "wss" : "ws"}://{u.host}/ws
        </code>
      </>
    );
  } catch {
    return "Invalid URL";
  }
}

function NetworkIcon({ size = 14, className }: { size?: number; className?: string }) {
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
      className={className}
      aria-hidden
    >
      <title>network</title>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}
