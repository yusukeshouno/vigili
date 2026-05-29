import Link from "next/link";
import type { Copy, Lang } from "@/lib/copy";
import { Sparkle, VigiliMark } from "./Sparkle";
import { WaitlistForm } from "./WaitlistForm";

export function Footer({ lang, copy }: { lang: Lang; copy: Copy }) {
  return (
    <footer className="foot">
      <Sparkle
        className="bg-sparkle"
        style={{
          bottom: -60,
          right: -40,
          width: 420,
          height: 420,
          opacity: 0.08,
          color: "var(--color-coral-soft)",
        }}
      />
      <Sparkle
        className="bg-sparkle"
        style={{
          top: 40,
          left: -30,
          width: 200,
          height: 200,
          opacity: 0.06,
          color: "var(--color-coral-soft)",
        }}
      />
      <div className="wrap">
        <div className="foot-hero">
          <span className="eyebrow" style={{ color: "var(--color-coral-soft)" }}>
            {copy.footerEyebrow}
          </span>
          <h2>{copy.footerTitle}</h2>
          <WaitlistForm lang={lang} copy={copy} variant="dark" />
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
