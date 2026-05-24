import type { Copy } from "@/lib/copy";
import { StarMark } from "./StarMark";

export function Footer({ copy }: { copy: Copy }) {
  return (
    <footer className="mx-auto w-full max-w-6xl border-t border-(--color-border) px-6 py-12 sm:px-10">
      <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2.5">
          <StarMark size={18} />
          <span className="font-display text-[14px] tracking-tight">Vigili</span>
          <span className="ml-3 text-[12px] text-(--color-fg-dim)">— {copy.footerTagline}</span>
        </div>

        <nav className="flex items-center gap-5 text-[12px] text-(--color-fg-mid)">
          <a
            href="https://github.com/yusukeshouno/vigili"
            target="_blank"
            rel="noreferrer"
            className="press hover:text-(--color-fg)"
          >
            {copy.footerOss}
          </a>
          <a
            href="https://relay.vigili.io/healthz"
            target="_blank"
            rel="noreferrer"
            className="press hover:text-(--color-fg)"
          >
            {copy.footerStatus}
          </a>
        </nav>
      </div>
      <p className="mt-6 font-mono text-[10px] tracking-[0.12em] uppercase text-(--color-fg-dim)">
        © {new Date().getFullYear()} Vigili
      </p>
    </footer>
  );
}
