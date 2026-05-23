"use client";

import { useId } from "react";

/**
 * Vigili brand mark — handoff bundle v3.
 *
 * 4 花弁 (N/E/S/W) + 中心ドット の sparkle/flower 型。
 * (16,16) 中心の 4 回回転で構成 → 上下左右対称。
 * feTurbulence で微かな手描き質感を残す (scale 0.9)。
 */

interface Props {
  size?: number;
}

export function Brand({ size = 30 }: Props) {
  return (
    <div className="flex items-center gap-2.5">
      <PetalMark size={size} color="var(--color-accent)" />
      <VigiliWordmark size={Math.round(size * 0.66)} />
    </div>
  );
}

export function AuroraLogo({ size = 32 }: { size?: number }) {
  return <PetalMark size={size} color="var(--color-accent)" />;
}

/**
 * 4 花弁 + 中心ドットの brand mark。
 * sentire (感じ取る) のメタファとして中央にひとつの「目」を置き、
 * 周囲を花弁で囲って Vigili (見張り人たち) を示す。
 */
export function PetalMark({
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
  const petal = "M 16 14 C 13 11 13 7 16 4 C 19 7 19 11 16 14 Z";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      style={{ display: "block", overflow: "visible" }}
      aria-hidden
    >
      <title>Vigili</title>
      <defs>
        <filter id={`sk-${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves={2} seed={3} />
          <feDisplacementMap in="SourceGraphic" scale={scale} />
        </filter>
      </defs>
      <g filter={`url(#sk-${id})`} fill={color}>
        <path d={petal} />
        <path d={petal} transform="rotate(90 16 16)" />
        <path d={petal} transform="rotate(180 16 16)" />
        <path d={petal} transform="rotate(270 16 16)" />
        <circle cx={16} cy={16} r={1.5} />
      </g>
    </svg>
  );
}

/** 後方互換のための alias。新しいコードからは `PetalMark` を使う。 */
export const HandDrawnShield = PetalMark;

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
