import Link from "next/link";
import type { Copy, Lang } from "@/lib/copy";
import { VigiliMark } from "./Sparkle";

export function TopBar({ lang, copy }: { lang: Lang; copy: Copy }) {
  const otherLang: Lang = lang === "ja" ? "en" : "ja";
  return (
    <nav className="top">
      <div className="wrap">
        <Link href="#top" className="brand">
          <span className="mark">
            <VigiliMark size={28} />
          </span>
          <span className="name">Vigili</span>
        </Link>
        <div className="nav-r">
          <a href="#how">{copy.navHow}</a>
          <a href="#tour">{copy.navProduct}</a>
          <a href="#security">{copy.navSecurity}</a>
          <Link href={`/?lang=${otherLang}#top`} className="lang">
            {copy.langSwitchTo}
          </Link>
          <a href="#quickstart" className="cta">
            {copy.navWaitlist}
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </div>
    </nav>
  );
}
