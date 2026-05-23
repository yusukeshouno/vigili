"use client";

import { XIcon } from "@/components/Icon";
import { useEffect, useState } from "react";

/**
 * iOS Safari でホーム画面に追加していないユーザーへのヒントバー。
 * - standalone モードで開いている → 何も出さない
 * - 一度閉じた → 30 日表示しない (localStorage)
 * - iOS Safari でない → 出さない
 */
const DISMISS_KEY = "vigili-install-hint-dismissed-at";
const HIDE_DAYS = 30;

export function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!shouldShow()) return;
    setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = (): void => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // SSR / private mode
    }
    setShow(false);
  };

  return (
    <div
      className="safe-pb fixed bottom-0 left-0 right-0 z-40 px-4 pb-3"
      style={{
        background: "linear-gradient(180deg, transparent, rgba(38,38,36,0.95) 60%)",
      }}
    >
      <div
        className="a-surface mx-auto flex max-w-md items-start gap-3"
        style={{ padding: "12px 14px" }}
      >
        <div className="flex-1">
          <p className="text-(--color-fg)" style={{ fontSize: 13, fontWeight: 500 }}>
            ホーム画面に追加すると速くなります
          </p>
          <p
            className="text-(--color-fg-mid)"
            style={{ fontSize: 12, lineHeight: 1.45, marginTop: 3 }}
          >
            Safari の <ShareIcon /> から「
            <em style={{ color: "var(--color-fg)" }}>ホーム画面に追加</em>」 →
            通知タップで即起動できます
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="閉じる"
          className="press inline-flex size-7 shrink-0 items-center justify-center rounded-full text-(--color-fg-mid) hover:text-(--color-fg)"
          style={{ border: "1px solid var(--color-border)" }}
        >
          <XIcon size={12} />
        </button>
      </div>
    </div>
  );
}

function shouldShow(): boolean {
  // standalone (PWA installed) なら出さない
  if (matchMedia("(display-mode: standalone)").matches) return false;
  if ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone) return false;
  // iOS Safari 判定: WebKit + Mobile + Apple device
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/u.test(ua);
  const isSafari = /Safari/u.test(ua) && !/CriOS|FxiOS|EdgiOS/u.test(ua);
  if (!isIos || !isSafari) return false;
  // 30 日以内に閉じたら出さない
  try {
    const last = Number(window.localStorage.getItem(DISMISS_KEY) ?? "0");
    if (Number.isFinite(last) && last > 0) {
      const ageDays = (Date.now() - last) / (1000 * 60 * 60 * 24);
      if (ageDays < HIDE_DAYS) return false;
    }
  } catch {
    // ignore
  }
  return true;
}

function ShareIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "inline-block", verticalAlign: "-2px", margin: "0 2px" }}
      aria-hidden
    >
      <title>share</title>
      <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );
}
