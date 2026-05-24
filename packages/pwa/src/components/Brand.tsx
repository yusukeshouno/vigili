"use client";

import { useId } from "react";

/**
 * Vigili brand mark — handoff bundle v5 (star, 10 spikes).
 *
 * 20 頂点 (10 突点 + 10 凹点) の不規則星型。
 * 原典は viewBox 0 0 105 118.52 の Adobe Illustrator SVG。
 * bbox 中心 (52.51, 59.26) を canvas 中央に合わせて配置する。
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

/** 10 突点星 v3 の SVG path d (Adobe Illustrator 出力、突点に軽い curve あり)。
 * 原典 viewBox 0 0 105 118.52、bbox 中心 (52.51, 59.26)。 */
const STAR_PATH_D =
  "M58.7,40.35l24.64-27.36c.54-.6,1.49.05,1.13.77l-16.58,32.87c-.26.51.18,1.1.75.99l32.42-6.32c.76-.15,1.15.89.48,1.27l-27.71,15.96c-.48.28-.45.98.05,1.22l28.04,13.29c.72.34.39,1.42-.4,1.3l-34.65-5.08c-.58-.08-.99.54-.69,1.04l17.59,28.61c.42.69-.48,1.42-1.06.86l-22.96-22.03c-.41-.39-1.09-.15-1.16.41l-3.96,32.38c-.1.78-1.22.82-1.36.04l-5.76-32.08c-.1-.56-.81-.77-1.19-.34l-24.64,27.36c-.54.6-1.49-.05-1.13-.77l16.58-32.87c.26-.51-.18-1.1-.75-.99l-32.42,6.32c-.76.15-1.15-.89-.48-1.27l27.71-15.96c.48-.28.45-.98-.05-1.22L3.09,45.47c-.72-.34-.39-1.42.4-1.3l34.65,5.08c.58.08.99-.54.69-1.04l-17.59-28.61c-.42-.69.48-1.42,1.06-.86l22.96,22.03c.41.39,1.09.15,1.16-.41l3.96-32.38c.1-.78,1.22-.82,1.36-.04l5.76,32.08c.1.56.81.77,1.19.34Z";

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
