"use client";

import { useState } from "react";
import type { Copy, Lang } from "@/lib/copy";
import { submitWaitlist } from "@/lib/waitlist";

type Status = "idle" | "submitting" | "success" | "error";

export function WaitlistForm({
  lang,
  copy,
  variant = "light",
}: {
  lang: Lang;
  copy: Copy;
  /** "light" = paper hero, "dark" = inverted (footer) */
  variant?: "light" | "dark";
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const submitting = status === "submitting";
  const success = status === "success";

  // 全体が dark 化したので variant 間の差はほぼないが、footer は少し contrast を上げる
  const inputStyle =
    variant === "dark"
      ? {
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.12)",
        }
      : undefined;
  const buttonStyle = undefined;

  return (
    <form
      className="h-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (submitting) return;
        const form = e.currentTarget;
        const fd = new FormData(form);
        fd.set("lang", lang);
        fd.set("ua", typeof navigator !== "undefined" ? navigator.userAgent : "");
        setStatus("submitting");
        setErrorMsg(null);
        const r = await submitWaitlist(fd);
        if (r.ok) {
          setStatus("success");
          form.reset();
        } else {
          setStatus("error");
          setErrorMsg(r.error ?? null);
        }
      }}
      style={{ flexDirection: "column", alignItems: "flex-start", gap: 10 }}
    >
      <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 460 }}>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder={copy.heroWaitlistPlaceholder}
          disabled={submitting || success}
          style={inputStyle}
        />
        <button type="submit" disabled={submitting || success} style={buttonStyle}>
          {submitting
            ? copy.heroWaitlistSubmitting
            : success
              ? "✓ On the list"
              : copy.heroWaitlistSubmit}
        </button>
      </div>
      <div className="h-meta meta">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
        {success
          ? copy.heroWaitlistSuccess
          : status === "error"
            ? `${copy.heroWaitlistError}${errorMsg ? ` (${errorMsg})` : ""}`
            : copy.heroFineprint}
      </div>
    </form>
  );
}
