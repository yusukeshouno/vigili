import Link from "next/link";
import type { Copy, Lang } from "@/lib/copy";
import { VigiliMark } from "./Sparkle";
import { DownloadCTA } from "./DownloadCTA";

export function Footer({ lang, copy }: { lang: Lang; copy: Copy }) {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-hero">
          <span className="eyebrow" style={{ color: "var(--color-coral-soft)" }}>
            {copy.footerEyebrow}
          </span>
          <h2>{copy.footerTitle}</h2>
          <DownloadCTA copy={copy} variant="dark" />
        </div>
        <div className="foot-row">
          <Link href="#top" className="brand">
            <span className="mark">
              <VigiliMark size={22} />
            </span>
            <span className="name">Vigili</span>
          </Link>
          <div>
            © {new Date().getFullYear()} Vigili · <Link href="/privacy">{copy.footerPrivacy}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
