import type { Copy, Lang } from "@/lib/copy";
import { WaitlistForm } from "./WaitlistForm";

export function Hero({ lang, copy }: { lang: Lang; copy: Copy }) {
  return (
    <section
      id="top"
      className="relative mx-auto flex w-full max-w-6xl flex-col items-start gap-10 px-6 pt-12 pb-24 sm:px-10 sm:pt-20 sm:pb-32"
    >
      {/* eyebrow */}
      <span className="label">{copy.heroEyebrow}</span>

      {/* title */}
      <h1
        className="font-display text-[40px] leading-[1.05] tracking-tight sm:text-[64px] sm:leading-[0.98]"
        style={{ whiteSpace: "pre-line" }}
      >
        {copy.heroTitle}
      </h1>

      {/* subtitle */}
      <p className="max-w-2xl text-[15px] text-(--color-fg-mid) sm:text-[17px]">
        {copy.heroSubtitle}
      </p>

      {/* waitlist form */}
      <div id="waitlist" className="w-full max-w-md pt-2">
        <WaitlistForm lang={lang} copy={copy} />
      </div>
    </section>
  );
}
