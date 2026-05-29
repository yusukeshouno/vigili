"use client";

import { useId } from "react";

/**
 * Vigili brand mark — handoff bundle v6 (star, 10 sharper spikes).
 *
 * 20 頂点 (10 突点 + 10 凹点) の不規則星型、突点が伸びた版。
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

/** 10 突点星 v5 の SVG path d (Adobe Illustrator 出力、最新版)。
 * 原典 viewBox 0 0 105 118.52、bbox 中心 (52.5, 59.26)。 */
const STAR_PATH_D =
  "M57.7,43.49l27.2-32.6c.46-.55,1.32.04.97.67l-20.55,37.15c-.25.45.16.98.66.86l37.4-9.01c.68-.16,1.03.79.41,1.1l-33.5,16.96c-.45.23-.43.88.04,1.07l33.56,14.01c.66.27.36,1.26-.34,1.13l-36.59-7.24c-.5-.1-.88.44-.62.88l19.69,33.27c.36.61-.45,1.22-.94.71l-26.51-27.77c-.35-.37-.98-.15-1.02.36l-2.96,37.88c-.06.71-1.08.74-1.18.03l-5.07-37.64c-.07-.51-.71-.7-1.04-.3l-27.2,32.6c-.46.55-1.32-.04-.97-.67l20.55-37.15c.25-.45-.16-.98-.66-.86L1.62,77.95c-.68.16-1.03-.79-.41-1.1l33.5-16.96c.45-.23.43-.88-.04-1.07L1.11,44.81c-.66-.27-.36-1.26.34-1.13l36.59,7.24c.5.1.88-.44.62-.88L18.98,16.78c-.36-.61.45-1.22.94-.71l26.51,27.77c.35.37.98.15,1.02-.36l2.96-37.88c.06-.71,1.08-.74,1.18.03l5.07,37.64c.07.51.71.7,1.04.3v-.02Z";

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
