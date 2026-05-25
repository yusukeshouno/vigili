import type { Copy } from "@/lib/copy";

/**
 * Hero 下の Showcase section。
 *
 * 構成: 左に 3-step narrative (テキストのみ)、右に代表 1 画面 (iOS Queue) を大きく。
 * モバイル幅では縦に積む (テキスト上、画像下)。
 *
 * 「画像が入る意味性が無い」を避けつつ、画像枚数は 1 枚に絞る。
 * Queue 画面は「実際に Allow/Deny する瞬間」を語る最も product-defining なショット。
 *
 * 補助スクショ (mac-welcome.png / ios-dynamic-island.png) は public/screenshots/ に
 * 残してあるが、現状 LP では使わない (将来 Press Kit や docs で再利用予定)。
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
        <p className="mt-4 max-w-xl text-[14px] text-(--color-fg-mid)">
          {copy.showcaseLead}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-16 md:items-center">
        {/* steps */}
        <ol className="flex flex-col gap-10 md:col-span-7">
          <Step
            n="01"
            headline={copy.showcaseStep1Title}
            body={copy.showcaseStep1Body}
          />
          <Step
            n="02"
            headline={copy.showcaseStep2Title}
            body={copy.showcaseStep2Body}
          />
          <Step
            n="03"
            headline={copy.showcaseStep3Title}
            body={copy.showcaseStep3Body}
            accent
          />
        </ol>

        {/* phone — autoplay looping video of cards appearing + being approved */}
        <figure className="flex justify-center md:col-span-5 md:justify-end">
          <PhoneFrame
            poster="/screenshots/ios-queue.png"
            mp4="/screenshots/queue-loop.mp4"
            webm="/screenshots/queue-loop.webm"
            alt="Vigili iOS app: 3 pending cards appearing then being approved"
          />
        </figure>
      </div>
    </section>
  );
}

function Step({
  n,
  headline,
  body,
  accent = false,
}: {
  n: string;
  headline: string;
  body: string;
  /** 最終ステップを少し強調 (突き当たり感)。 */
  accent?: boolean;
}) {
  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2">
      <span
        className="font-mono text-[11px] tracking-[0.18em] pt-1"
        style={{
          color: accent ? "var(--color-accent)" : "var(--color-fg-dim)",
        }}
      >
        {n}
      </span>
      <h3 className="font-display text-[18px] leading-tight tracking-tight text-(--color-fg)">
        {headline}
      </h3>
      <span aria-hidden /> {/* spacer to align body under headline column */}
      <p className="text-[14px] leading-[1.65] text-(--color-fg-mid)">{body}</p>
    </li>
  );
}

/**
 * iPhone デバイス枠 (黒 bezel + drop shadow) に動画を入れる。
 * autoplay + muted + loop + playsInline で iOS Safari でも自動再生される。
 * poster で video の load 前 / 初期表示に静止画を見せる。
 */
function PhoneFrame({
  poster,
  mp4,
  webm,
  alt,
}: {
  poster: string;
  mp4: string;
  webm: string;
  alt: string;
}) {
  return (
    <div
      className="relative"
      style={{
        width: "100%",
        maxWidth: 280,
        aspectRatio: "9 / 19.5",
        borderRadius: 42,
        padding: 9,
        background: "linear-gradient(180deg, #1a1917 0%, #0e0d0c 100%)",
        boxShadow:
          "0 0 0 1px rgba(250,247,242,0.06), 0 40px 80px -20px rgba(0,0,0,0.7), 0 16px 32px -16px rgba(0,0,0,0.5)",
      }}
    >
      <div
        className="relative h-full w-full overflow-hidden bg-(--color-bg-rise)"
        style={{ borderRadius: 33 }}
      >
        <video
          poster={poster}
          aria-label={alt}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        >
          <source src={webm} type="video/webm" />
          <source src={mp4} type="video/mp4" />
        </video>
      </div>
    </div>
  );
}
