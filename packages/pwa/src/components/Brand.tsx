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

/** 8 突点星の polygon points (原典 viewBox 0 0 105 118.52 の座標)。 */
const STAR_POINTS =
  "59.94 45.86 89.54 23.53 67.84 53.59 105 58.73 67.95 64.65 85.38 89.44 60.22 72.54 55.18 118.52 49.17 72.66 19.57 94.98 41.27 64.93 0 59.79 41.15 53.87 23.73 29.08 48.89 45.98 53.93 0";

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
        <polygon points={STAR_POINTS} />
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
