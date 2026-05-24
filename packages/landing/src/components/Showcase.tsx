import Image from "next/image";
import type { Copy } from "@/lib/copy";

/**
 * Hero 下の Showcase section。
 *
 * 思想: 3 枚並べるが「UI 一覧」ではなく「1 件の承認が解決するまでの 3 ステップ」
 * という narrative に紐付ける。番号付き、左から右、矢印で接続。
 *
 *   01 → 02 → 03
 *   Setup    Notify    Approve
 *
 * 画像は public/screenshots/:
 *   - mac-welcome.png         (step 01: 接続セットアップ)
 *   - ios-dynamic-island.png  (step 02: pending が iOS に届く)
 *   - ios-queue.png           (step 03: タップで承認)
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
        <p className="mt-4 max-w-xl text-[14px] text-(--color-fg-mid)">
          {copy.showcaseLead}
        </p>
      </header>

      <ol className="grid grid-cols-1 gap-12 md:grid-cols-3 md:gap-8">
        <Step
          n="01"
          headline={copy.showcaseStep1Title}
          body={copy.showcaseStep1Body}
          variant="mac"
          src="/screenshots/mac-welcome.png"
          alt="Vigili Welcome panel with QR code"
        />
        <Step
          n="02"
          headline={copy.showcaseStep2Title}
          body={copy.showcaseStep2Body}
          variant="phone"
          src="/screenshots/ios-dynamic-island.png"
          alt="iPhone Home screen with Vigili Live Activity in the Dynamic Island"
        />
        <Step
          n="03"
          headline={copy.showcaseStep3Title}
          body={copy.showcaseStep3Body}
          variant="phone"
          src="/screenshots/ios-queue.png"
          alt="Vigili iOS app showing pending approval cards"
        />
      </ol>
    </section>
  );
}

function Step({
  n,
  headline,
  body,
  variant,
  src,
  alt,
}: {
  n: string;
  headline: string;
  body: string;
  variant: "mac" | "phone";
  src: string;
  alt: string;
}) {
  return (
    <li className="flex flex-col items-center text-center">
      {/* number */}
      <span className="font-mono text-[11px] tracking-[0.18em] text-(--color-accent) mb-3">
        {n}
      </span>

      {/* headline */}
      <h3 className="font-display text-[18px] leading-tight tracking-tight text-(--color-fg) mb-2 px-2">
        {headline}
      </h3>

      {/* body */}
      <p className="text-[13px] leading-[1.55] text-(--color-fg-mid) mb-8 max-w-[260px]">
        {body}
      </p>

      {/* image */}
      <div className="relative flex w-full justify-center">
        {variant === "phone" ? (
          <PhoneFrame src={src} alt={alt} />
        ) : (
          <MacFrame src={src} alt={alt} />
        )}
      </div>
    </li>
  );
}

/**
 * iPhone らしいデバイス枠 (黒 bezel + Dynamic Island なし、画面だけ強調)。
 * 縦長 9:19.5 比率 + 大きめ rounded で「物理的な iPhone」っぽく見せる。
 * 影付き。
 */
function PhoneFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div
      className="relative"
      style={{
        width: "100%",
        maxWidth: 220,
        aspectRatio: "9 / 19.5",
        borderRadius: 38,
        padding: 8,
        background: "linear-gradient(180deg, #1a1917 0%, #0e0d0c 100%)",
        boxShadow:
          "0 0 0 1px rgba(250,247,242,0.05), 0 30px 60px -20px rgba(0,0,0,0.6), 0 12px 24px -12px rgba(0,0,0,0.4)",
      }}
    >
      <div
        className="relative h-full w-full overflow-hidden bg-(--color-bg-rise)"
        style={{ borderRadius: 30 }}
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes="220px"
          style={{ objectFit: "cover" }}
        />
      </div>
    </div>
  );
}

/**
 * Mac ウィンドウっぽい枠 (薄い border + 大きめ shadow)。
 * 16:13 程度の比率で popover/welcome を入れる。
 */
function MacFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        maxWidth: 320,
        aspectRatio: "320 / 280",
        borderRadius: 18,
        boxShadow:
          "0 0 0 1px rgba(250,247,242,0.08), 0 30px 60px -20px rgba(0,0,0,0.6), 0 12px 24px -12px rgba(0,0,0,0.4)",
      }}
    >
      <Image
        src={src}
        alt={alt}
        fill
        sizes="320px"
        style={{ objectFit: "cover", objectPosition: "center top" }}
      />
    </div>
  );
}
