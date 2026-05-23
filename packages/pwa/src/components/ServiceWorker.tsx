"use client";

import { useEffect } from "react";

/**
 * /sw.js を登録するだけのコンポーネント。
 * dev (Next.js HMR) では HMR 干渉を避けるため SW 登録をスキップする。
 */
export function ServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("[vigili-sw] register failed:", err);
    });
  }, []);
  return null;
}
