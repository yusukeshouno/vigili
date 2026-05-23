"use client";

import { useId } from "react";

/**
 * Vigili brand mark — handoff bundle v4 (star).
 *
 * 16 頂点 (8 突点 + 8 凹点) の不規則星型。
 * 原典は viewBox 0 0 105 118.52 の Adobe Illustrator SVG。
 * bbox 中心 (52.5, 59.26) を canvas 中央に合わせて配置する。
 * feTurbulence で微かな手描き質感を残す (scale 0.9)。
 */

interface Props {
  size?: number;
}

export function Brand({ size = 30 }: Props) {
  return (
    <div className="flex items-center gap-2.5">
      <StarMark size={size} color="var(--color-accent)" />
      <VigiliWordmark size={Math.round(size * 0.66)} />
    </div>
  );
}

export function AuroraLogo({ size = 32 }: { size?: number }) {
  return <StarMark size={size} color="var(--color-accent)" />;
}

/** 8 突点星の SVG path d (Adobe Illustrator 出力、突点に curve あり)。
 * 原典 viewBox 0 0 105 118.52、bbox 中心 (52.5, 59.26)。 */
const STAR_PATH_D =
  "M60.75,45.25l25.6-19.31c.55-.42,1.26.27.85.83l-18.77,26c-.27.37-.04.89.41.95l32.16,4.45c.69.09.7,1.08.01,1.19l-32.1,5.12c-.44.07-.65.58-.4.94l15,21.35c.38.55-.27,1.22-.83.85l-21.65-14.55c-.37-.25-.87-.02-.93.42l-4.37,32.28c-.09.69-1.08.7-1.19.02l-5.2-32.16c-.07-.45-.6-.66-.96-.39l-25.6,19.31c-.55.42-1.26-.27-.85-.83l18.76-25.99c.27-.37.04-.89-.41-.95l-35.8-4.46c-.7-.09-.71-1.1-.01-1.2l35.73-5.13c.45-.06.67-.58.41-.94l-14.99-21.33c-.38-.55.27-1.22.83-.85l21.65,14.54c.37.25.88.02.93-.42l4.37-33.99c.09-.69,1.09-.7,1.19-.01l5.21,33.86c.07.45.59.66.96.39Z";

/**
 * 8 突点星の brand mark。
 * sentire (感じ取る) のメタファとして、ひとつの強い星 = 注視と覚醒を表す。
 * 見張り人 (Vigili) が灯す光のイメージ。
 */
export function StarMark({
  size = 32,
  color = "var(--color-accent)",
  scale = 0.9,
}: {
  size?: number;
  color?: string;
  /** feTurbulence の displacement scale (0 で完全均一)。 */
  scale?: number;
}) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9]/gu, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 105 118.52"
      style={{ display: "block", overflow: "visible" }}
      aria-hidden
    >
      <title>Vigili</title>
      <defs>
        <filter id={`sk-${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves={2} seed={3} />
          <feDisplacementMap in="SourceGraphic" scale={scale} />
        </filter>
      </defs>
      <g filter={`url(#sk-${id})`} fill={color}>
        <path d={STAR_PATH_D} />
      </g>
    </svg>
  );
}

/** 後方互換のための alias。新しいコードからは `StarMark` を使う。 */
export const HandDrawnShield = StarMark;
export const PetalMark = StarMark;

export function VigiliWordmark({ size = 20 }: { size?: number }) {
  return (
    <span
      className="font-display"
      style={{
        fontSize: size,
        fontWeight: 600,
        letterSpacing: "-0.02em",
        color: "var(--color-fg)",
        fontVariationSettings: '"wdth" 95',
      }}
    >
      Vigili
    </span>
  );
}
