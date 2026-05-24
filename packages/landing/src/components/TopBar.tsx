import Link from "next/link";
import type { Copy, Lang } from "@/lib/copy";
import { StarMark } from "./StarMark";

export function TopBar({ lang, copy }: { lang: Lang; copy: Copy }) {
  const otherLang: Lang = lang === "ja" ? "en" : "ja";
  return (
    <header
      className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 sm:px-10 sm:py-7"
    >
      <Link href="/" className="press flex items-center gap-2.5">
        <StarMark size={22} />
        <span className="font-display text-[17px] tracking-tight">Vigili</span>
      </Link>

      <nav className="flex items-center gap-5 text-[13px]">
        <Link
          href={`/?lang=${otherLang}#top`}
          className="font-mono text-[11px] uppercase tracking-[0.12em] text-(--color-fg-mid) press hover:text-(--color-fg)"
        >
          {copy.langSwitchTo}
        </Link>
        <a
          href="https://github.com/yusukeshouno/vigili"
          target="_blank"
          rel="noreferrer"
          className="hidden text-(--color-fg-mid) press hover:text-(--color-fg) sm:inline"
        >
          {copy.navGithub}
        </a>
        <a
          href="#waitlist"
          className="press inline-flex items-center gap-1.5 rounded-full border border-(--color-border-strong) px-4 py-1.5 text-[12px] hover:border-(--color-fg-mid)"
        >
          {copy.navWaitlist}
        </a>
      </nav>
    </header>
  );
}
