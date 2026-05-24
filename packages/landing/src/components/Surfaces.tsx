import type { Copy } from "@/lib/copy";

/**
 * Hero と Showcase の間に置く「Vigili はこの 3 つの場所で動く」セクション。
 *
 * Mac app (menu bar)、Mac widget (デスクトップ)、iPhone app の 3 surfaces。
 * 同じキューを 3 つの面から覗ける、という設計思想を一目で伝える。
 *
 * 視覚的には: 各 surface に小さい SVG アイコン + ラベル + 1 行説明。
 */
export function Surfaces({ copy }: { copy: Copy }) {
  return (
    <section
      id="surfaces"
      className="mx-auto w-full max-w-6xl border-t border-(--color-border) px-6 py-16 sm:px-10 sm:py-20"
    >
      <header className="mb-10">
        <span className="label block">{copy.surfacesEyebrow}</span>
        <h2 className="mt-3 font-display text-[24px] leading-[1.15] tracking-tight sm:text-[30px]">
          {copy.surfacesTitle}
        </h2>
      </header>

      <ul className="grid grid-cols-1 gap-6 md:grid-cols-3 md:gap-8">
        <SurfaceCard
          icon={<MacAppIcon />}
          name={copy.surfaceMacAppName}
          body={copy.surfaceMacAppBody}
        />
        <SurfaceCard
          icon={<WidgetIcon />}
          name={copy.surfaceWidgetName}
          body={copy.surfaceWidgetBody}
        />
        <SurfaceCard
          icon={<PhoneIcon />}
          name={copy.surfacePhoneName}
          body={copy.surfacePhoneBody}
        />
      </ul>
    </section>
  );
}

function SurfaceCard({
  icon,
  name,
  body,
}: {
  icon: React.ReactNode;
  name: string;
  body: string;
}) {
  return (
    <li
      className="flex flex-col gap-4 rounded-2xl border border-(--color-border) bg-(--color-bg-rise) px-6 py-6"
    >
      <div className="flex items-center gap-3">
        <span className="text-(--color-accent)">{icon}</span>
        <h3 className="font-display text-[16px] tracking-tight text-(--color-fg)">{name}</h3>
      </div>
      <p className="text-[13px] leading-[1.6] text-(--color-fg-mid)">{body}</p>
    </li>
  );
}

// ---------- icons ----------

/** Mac (menu bar). Laptop の輪郭 + 上端に menu bar 線を 1 本。 */
function MacAppIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* laptop screen */}
      <rect x="4" y="6" width="20" height="13" rx="1.5" />
      {/* menu bar line */}
      <line x1="4" y1="9.5" x2="24" y2="9.5" />
      {/* tiny menu bar dot (Vigili icon position hint) */}
      <circle cx="20.5" cy="8" r="0.8" fill="currentColor" stroke="none" />
      {/* laptop base */}
      <path d="M2.5 21.5 L25.5 21.5" />
      <path d="M11 23 L17 23" />
    </svg>
  );
}

/** Widget. シンプルな角丸 square + 数字風モチーフ。 */
function WidgetIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="20" height="20" rx="4" />
      {/* small "1" / pending count hint */}
      <path d="M11.5 17 V11" />
      <path d="M11.5 11 L9.5 12.5" />
      <line x1="6.5" y1="20.5" x2="14" y2="20.5" />
    </svg>
  );
}

/** iPhone. 縦長角丸 + Dynamic Island の楕円。 */
function PhoneIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="8" y="2.5" width="12" height="23" rx="3" />
      {/* Dynamic Island */}
      <rect x="11.5" y="4.7" width="5" height="1.7" rx="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}
