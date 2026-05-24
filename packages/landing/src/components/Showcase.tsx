import Image from "next/image";
import type { Copy } from "@/lib/copy";

/**
 * Hero 下の Showcase section。
 *
 * 2 枚並べ (md+): iOS Queue (左、縦長スマホ) + Dynamic Island/Home (右、縦長スマホ)。
 * モバイル幅では縦に積む。
 *
 * 画像は packages/landing/public/screenshots/ に置いてある:
 *   - ios-queue.png         (iPhone 17 Pro simctl screenshot — 3 PENDING の Queue)
 *   - ios-dynamic-island.png (Home screen + Dynamic Island のオレンジ)
 *   - mac-popover.png       (Mac menu bar popover、screencapture -w で抜く)
 */
export function Showcase({ copy }: { copy: Copy }) {
  return (
    <section
      id="showcase"
      className="mx-auto w-full max-w-6xl border-t border-(--color-border) px-6 py-20 sm:px-10 sm:py-24"
    >
      <header className="mb-12">
        <span className="label block">{copy.showcaseEyebrow}</span>
        <h2 className="mt-3 font-display text-[28px] leading-[1.1] tracking-tight sm:text-[36px]">
          {copy.showcaseTitle}
        </h2>
      </header>

      <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-14">
        <ShotCard
          src="/screenshots/ios-queue.png"
          alt="Vigili iOS app showing 3 pending approval cards"
          width={300}
          height={650}
          caption={copy.showcaseIosQueueCaption}
        />
        <ShotCard
          src="/screenshots/ios-dynamic-island.png"
          alt="iPhone Home screen with the Vigili Live Activity in the Dynamic Island"
          width={300}
          height={650}
          caption={copy.showcaseIosLiveCaption}
        />
      </div>

      {/* Mac は後で追加 (screencapture -w 待ち)。あったら一段下に出す。 */}
    </section>
  );
}

function ShotCard({
  src,
  alt,
  width,
  height,
  caption,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
}) {
  return (
    <figure className="flex flex-col items-center gap-5">
      <div
        className="relative overflow-hidden rounded-[42px] border border-(--color-border-strong) bg-(--color-bg-rise)"
        style={{ aspectRatio: `${width} / ${height}`, width: "100%", maxWidth: 360 }}
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(min-width: 768px) 360px, 90vw"
          style={{ objectFit: "cover" }}
          priority
        />
      </div>
      <figcaption className="max-w-xs text-center text-[13px] text-(--color-fg-mid)">
        {caption}
      </figcaption>
    </figure>
  );
}
