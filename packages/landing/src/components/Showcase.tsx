import Image from "next/image";
import type { Copy } from "@/lib/copy";

/**
 * Hero 下の Showcase section。3 枚並べる。
 *
 *   [Mac Welcome panel (wide)]
 *   [iOS Queue] [iOS Dynamic Island]
 *
 * 画像:
 *   - mac-welcome.png         Welcome panel + LAN QR
 *   - ios-queue.png           iOS in-app queue (3 PENDING)
 *   - ios-dynamic-island.png  Home + Dynamic Island の Live Activity
 *
 * Popover-with-pending shot は後で追加できるよう、コンポーネントの構造は
 * 簡単に増減できるようにしてある。
 */
export function Showcase({ copy }: { copy: Copy }) {
  return (
    <section
      id="showcase"
      className="mx-auto w-full max-w-6xl border-t border-(--color-border) px-6 py-20 sm:px-10 sm:py-24"
    >
      <header className="mb-14">
        <span className="label block">{copy.showcaseEyebrow}</span>
        <h2 className="mt-3 font-display text-[28px] leading-[1.1] tracking-tight sm:text-[36px]">
          {copy.showcaseTitle}
        </h2>
      </header>

      {/* Mac Welcome — 単独で大きく見せる */}
      <div className="mb-14 flex justify-center">
        <MacShot
          src="/screenshots/mac-welcome.png"
          alt="Vigili Welcome panel with LAN-direct QR code"
          caption={copy.showcaseMacWelcomeCaption}
        />
      </div>

      {/* iOS row */}
      <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-10">
        <PhoneShot
          src="/screenshots/ios-queue.png"
          alt="Vigili iOS app showing 3 pending approval cards"
          caption={copy.showcaseIosQueueCaption}
        />
        <PhoneShot
          src="/screenshots/ios-dynamic-island.png"
          alt="iPhone Home screen with the Vigili Live Activity in the Dynamic Island"
          caption={copy.showcaseIosLiveCaption}
        />
      </div>
    </section>
  );
}

function MacShot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="flex flex-col items-center gap-4">
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-(--color-border-strong) bg-(--color-bg-rise)"
        style={{ aspectRatio: "866 / 914", maxWidth: 520 }}
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(min-width: 768px) 520px, 90vw"
          style={{ objectFit: "contain" }}
          priority
        />
      </div>
      <figcaption className="max-w-md text-center text-[13px] text-(--color-fg-mid)">
        {caption}
      </figcaption>
    </figure>
  );
}

function PhoneShot({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className="flex flex-col items-center gap-4">
      <div
        className="relative w-full overflow-hidden rounded-[42px] border border-(--color-border-strong) bg-(--color-bg-rise)"
        style={{ aspectRatio: "300 / 650", maxWidth: 320 }}
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(min-width: 768px) 320px, 90vw"
          style={{ objectFit: "cover" }}
        />
      </div>
      <figcaption className="max-w-md text-center text-[13px] text-(--color-fg-mid)">
        {caption}
      </figcaption>
    </figure>
  );
}
