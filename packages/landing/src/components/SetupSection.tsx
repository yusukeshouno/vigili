"use client";

import { useState } from "react";
import type { Copy } from "@/lib/copy";

export function SetupSection({ copy }: { copy: Copy }) {
  return (
    <section
      id="setup"
      className="mx-auto w-full max-w-6xl border-t border-(--color-border) px-6 py-20 sm:px-10 sm:py-24"
    >
      <header className="mb-12">
        <span className="label block">{copy.setupEyebrow}</span>
        <h2 className="mt-3 font-display text-[28px] leading-[1.1] tracking-tight sm:text-[36px]">
          {copy.setupTitle}
        </h2>
        <p className="mt-4 max-w-xl text-[14px] text-(--color-fg-mid)">{copy.setupLead}</p>
      </header>

      <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-16">
        {/* Mac column */}
        <div className="flex flex-col gap-6">
          <h3 className="font-mono text-[11px] tracking-[0.18em] uppercase text-(--color-accent)">
            {copy.setupMacLabel}
          </h3>

          {copy.setupMacSteps.map((step) => (
            <SetupStep key={step.cmd ?? step.label} step={step} />
          ))}
        </div>

        {/* iPhone column */}
        <div className="flex flex-col gap-6">
          <h3 className="font-mono text-[11px] tracking-[0.18em] uppercase text-(--color-accent)">
            {copy.setupPhoneLabel}
          </h3>

          <ol className="flex flex-col gap-5">
            {copy.setupPhoneSteps.map((step, i) => (
              <li key={i} className="grid grid-cols-[28px_1fr] gap-3 items-start">
                <span
                  className="font-mono text-[11px] tracking-[0.1em] pt-[3px] text-right"
                  style={{ color: "var(--color-fg-dim)" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <SetupStep step={step} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

type Step = { label: string; cmd?: string; note?: string };

function SetupStep({ step }: { step: Step }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!step.cmd) return;
    navigator.clipboard.writeText(step.cmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[14px] leading-[1.55] text-(--color-fg)">{step.label}</p>

      {step.cmd && (
        <div
          className="group relative flex items-center gap-3 rounded-xl px-4 py-3"
          style={{
            background: "var(--color-bg-rise)",
            border: "1px solid var(--color-border)",
          }}
        >
          <code className="flex-1 font-mono text-[13px] text-(--color-fg) select-all leading-snug break-all">
            {step.cmd}
          </code>
          <button
            onClick={copy}
            aria-label={copied ? "Copied" : "Copy"}
            className="shrink-0 rounded-md p-1.5 transition-colors hover:bg-(--color-border) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--color-accent)"
          >
            {copied ? <CheckIcon /> : <ClipboardIcon />}
          </button>
        </div>
      )}

      {step.note && !step.cmd && (
        <p className="text-[12px] leading-[1.5] text-(--color-fg-dim)">{step.note}</p>
      )}
    </div>
  );
}

function ClipboardIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-(--color-fg-mid)"
    >
      <rect x="5" y="2" width="8" height="10" rx="1.2" />
      <path d="M5 4H3.5A1.5 1.5 0 0 0 2 5.5v7A1.5 1.5 0 0 0 3.5 14h5A1.5 1.5 0 0 0 10 12.5V11" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-(--color-accent)"
    >
      <polyline points="2.5,8 6,11.5 12.5,4" />
    </svg>
  );
}
