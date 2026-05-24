"use client";

import { useState } from "react";
import type { Copy, Lang } from "@/lib/copy";
import { submitWaitlist } from "@/lib/waitlist";

type Status = "idle" | "submitting" | "success" | "error";

export function WaitlistForm({ lang, copy }: { lang: Lang; copy: Copy }) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (status === "submitting") return;
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
      className="flex w-full flex-col gap-3"
    >
      <div className="flex w-full overflow-hidden rounded-full border border-(--color-border-strong) bg-(--color-bg-rise) focus-within:border-(--color-fg-mid)">
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder={copy.heroWaitlistPlaceholder}
          disabled={status === "submitting" || status === "success"}
          className="flex-1 bg-transparent px-5 py-3 text-[14px] text-(--color-fg) placeholder:text-(--color-fg-dim) focus:outline-none"
        />
        <button
          type="submit"
          disabled={status === "submitting" || status === "success"}
          className="press shrink-0 px-5 py-3 text-[13px] font-semibold text-white"
          style={{ background: "var(--color-accent)" }}
        >
          {status === "submitting"
            ? copy.heroWaitlistSubmitting
            : status === "success"
              ? "✓"
              : copy.heroWaitlistSubmit}
        </button>
      </div>

      <p className="text-[11px] text-(--color-fg-dim)">
        {status === "success"
          ? copy.heroWaitlistSuccess
          : status === "error"
            ? `${copy.heroWaitlistError}${errorMsg ? ` (${errorMsg})` : ""}`
            : copy.heroFineprint}
      </p>
    </form>
  );
}
