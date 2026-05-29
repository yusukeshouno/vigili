import type { CSSProperties } from "react";

/**
 * グローバルに `<symbol id="sparkle">` を登録する不可視 SVG。
 * RootLayout で 1 回だけ描画し、各セクションは `<Sparkle />` で `<use>` する。
 *
 * Path は icons-01 (12-point star, Adobe Illustrator output, viewBox 0 0 105 118.52)。
 */
export function SparkleSymbol() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol id="sparkle" viewBox="0 0 105 118.52">
          <path
            d="M60.75,45.25l25.6-19.31c.55-.42,1.26.27.85.83l-18.77,26c-.27.37-.04.89.41.95l32.16,4.45c.69.09.7,1.08.01,1.19l-32.1,5.12c-.44.07-.65.58-.4.94l15,21.35c.38.55-.27,1.22-.83.85l-21.65-14.55c-.37-.25-.87-.02-.93.42l-4.37,32.28c-.09.69-1.08.7-1.19.02l-5.2-32.16c-.07-.45-.6-.66-.96-.39l-25.6,19.31c-.55.42-1.26-.27-.85-.83l18.76-25.99c.27-.37.04-.89-.41-.95l-35.8-4.46c-.7-.09-.71-1.1-.01-1.2l35.73-5.13c.45-.06.67-.58.41-.94l-14.99-21.33c-.38-.55.27-1.22.83-.85l21.65,14.54c.37.25.88.02.93-.42l4.37-33.99c.09-.69,1.09-.7,1.19-.01l5.21,33.86c.07.45.59.66.96.39Z"
            fill="currentColor"
          />
        </symbol>
      </defs>
    </svg>
  );
}

/**
 * `<symbol id="sparkle">` を使う薄いラッパ。className / style / sizes をそのまま渡す。
 * SVG の color は currentColor なので、親要素の `color` で塗りを変えられる。
 */
export function Sparkle({
  className,
  style,
  width,
  height,
  size,
  title,
}: {
  className?: string;
  style?: CSSProperties;
  width?: number | string;
  height?: number | string;
  size?: number | string;
  title?: string;
}) {
  const w = width ?? size;
  const h = height ?? size;
  return (
    <svg
      className={className}
      style={style}
      width={w}
      height={h}
      viewBox="0 0 105 118.52"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <use href="#sparkle" />
    </svg>
  );
}

/**
 * 角丸スクエア背景 + 中央に sparkle のアプリアイコン (Coral Solid, 01 案)。
 * ナビゲーション・フッター・ウィジェットなどで使う。
 */
export function VigiliMark({ size = 28 }: { size?: number }) {
  // clipPath の id をユーザに見えない範囲でユニークに（複数描画で衝突しないように）
  const id = `vsq-${size}`;
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <defs>
        <clipPath id={id}>
          <path d="M 22,0 H 78 C 92,0 100,8 100,22 V 78 C 100,92 92,100 78,100 H 22 C 8,100 0,92 0,78 V 22 C 0,8 8,0 22,0 Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`}>
        <rect width="100" height="100" fill="#D97757" />
        <use href="#sparkle" x="20" y="14" width="60" height="68" style={{ color: "#F5EFE3" }} />
      </g>
    </svg>
  );
}
