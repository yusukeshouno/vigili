"use client";

import { CheckIcon, XIcon } from "@/components/Icon";
import { regexIsValid, ruleMatchesRequest, suggestRule } from "@/lib/regex-suggest";
import type { ApprovalRequest, PromoteRule } from "@sentinel/shared";
import { useEffect, useMemo, useState } from "react";

interface Props {
  request: ApprovalRequest;
  onCancel: () => void;
  onConfirm: (promote: PromoteRule) => void;
}

export function RulePromoteModal({ request, onCancel, onConfirm }: Props) {
  const initial = useMemo(() => suggestRule(request), [request]);
  const [name, setName] = useState(initial.rule_name);
  const [regexField] = useState<"command" | "path" | "url">(() =>
    request.tool_name === "Bash" ? "command" : request.tool_name === "WebFetch" ? "url" : "path",
  );
  const [regexValue, setRegexValue] = useState(
    initial.match.command_matches ?? initial.match.path_matches ?? initial.match.url_matches ?? "",
  );
  const [restrictRepo, setRestrictRepo] = useState(
    Array.isArray(initial.match.repo_in) && initial.match.repo_in.length > 0,
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const promote = useMemo<PromoteRule>(() => {
    const match: PromoteRule["match"] = { tool: request.tool_name };
    if (regexField === "command") match.command_matches = regexValue;
    if (regexField === "path") match.path_matches = regexValue;
    if (regexField === "url") match.url_matches = regexValue;
    if (restrictRepo && request.session_tag) match.repo_in = [request.session_tag];
    return { rule_name: name.trim() || initial.rule_name, match };
  }, [name, regexField, regexValue, restrictRepo, request, initial.rule_name]);

  const validRegex = regexIsValid(regexValue);
  const matchesNow = validRegex && ruleMatchesRequest(promote, request);
  const submitDisabled = !validRegex || !matchesNow || regexValue.length === 0;

  const fieldLabel =
    regexField === "command"
      ? "command_matches"
      : regexField === "path"
        ? "path_matches"
        : "url_matches";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "rgba(38,38,36,0.7)" }}
    >
      <div
        className="a-surface-raised safe-pb relative flex max-h-[90dvh] w-full flex-col overflow-y-auto"
        style={{
          maxWidth: 480,
          borderRadius: 16,
          background: "var(--color-bg-rise)",
        }}
      >
        {/* header */}
        <header
          className="flex items-start justify-between gap-3 px-6 pt-5 pb-4"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div>
            <h2
              className="font-display text-(--color-fg)"
              style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.01em" }}
            >
              Save as rule
            </h2>
            <p className="label mt-1" style={{ fontSize: 10 }}>
              future matching asks will auto-allow
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="閉じる"
            className="press inline-flex size-8 items-center justify-center rounded-full text-(--color-fg-mid) hover:text-(--color-fg)"
            style={{ border: "1px solid var(--color-border)" }}
          >
            <XIcon size={14} />
          </button>
        </header>

        <div className="flex flex-col gap-4 px-6 py-4">
          <Field label="rule name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="a-input font-mono w-full bg-transparent outline-none"
              style={{
                padding: "10px 14px",
                color: "var(--color-fg)",
                fontSize: 13,
              }}
            />
          </Field>

          <Field label={`${fieldLabel} (regex)`}>
            <input
              type="text"
              value={regexValue}
              onChange={(e) => setRegexValue(e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="font-mono w-full bg-transparent outline-none"
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                border: validRegex ? "1px solid var(--color-border)" : "1px solid var(--color-red)",
                color: "var(--color-fg)",
                fontSize: 13,
              }}
            />
            {!validRegex ? (
              <span
                className="mt-2 inline-block"
                style={{ color: "var(--color-red-soft)", fontSize: 12 }}
              >
                invalid regex
              </span>
            ) : null}
          </Field>

          {request.session_tag ? (
            <label className="a-input flex items-start gap-3" style={{ padding: "12px 14px" }}>
              <input
                type="checkbox"
                checked={restrictRepo}
                onChange={(e) => setRestrictRepo(e.target.checked)}
                className="mt-0.5 size-4 accent-(--color-accent)"
              />
              <span style={{ fontSize: 13, lineHeight: 1.4 }}>
                <span className="text-(--color-fg)" style={{ fontWeight: 500 }}>
                  limit to{" "}
                  <code className="font-mono" style={{ fontSize: 12 }}>
                    {request.session_tag}
                  </code>
                </span>
                <span className="label mt-1 block" style={{ fontSize: 10 }}>
                  other repos still ask
                </span>
              </span>
            </label>
          ) : null}

          <div className="a-input" style={{ padding: "10px 14px" }}>
            <p className="label" style={{ fontSize: 10 }}>
              preview
            </p>
            <p
              className="font-mono mt-1 inline-flex items-center gap-1.5"
              style={{
                fontSize: 12,
                color: matchesNow ? "var(--color-green-soft)" : "var(--color-amber)",
              }}
            >
              {matchesNow ? <CheckIcon size={13} /> : <XIcon size={13} />}
              {matchesNow ? "matches this request" : "regex doesn't match the current request"}
            </p>
          </div>
        </div>

        <footer
          className="flex items-center justify-end gap-2 px-6 pt-3 pb-5"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <button type="button" onClick={onCancel} className="a-btn-quiet">
            cancel
          </button>
          <button
            type="button"
            disabled={submitDisabled}
            onClick={() => onConfirm(promote)}
            className="a-btn-primary"
          >
            <CheckIcon size={14} strokeWidth={1.8} />
            Save & allow
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-2">{label}</div>
      {children}
    </div>
  );
}
