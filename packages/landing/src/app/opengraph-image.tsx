import { ImageResponse } from "next/og";

/**
 * 動的 OG 画像 (1200x630)。
 * Twitter / Slack / Discord 等で URL を貼った時に表示される。
 *
 * Next.js のエッジレンダリングで生成 — 画像アセットを repo に置く必要なし。
 */

export const runtime = "edge";
export const alt = "Vigili — Approve Claude Code from your phone";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#262624",
        color: "rgba(250,247,242,0.95)",
        padding: 80,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* top: logo + wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <svg width="48" height="48" viewBox="0 0 105 118.52" xmlns="http://www.w3.org/2000/svg">
          <path
            fill="#c16141"
            d="M58.7,40.35l24.64-27.36c.54-.6,1.49.05,1.13.77l-16.58,32.87c-.26.51.18,1.1.75.99l32.42-6.32c.76-.15,1.15.89.48,1.27l-27.71,15.96c-.48.28-.45.98.05,1.22l28.04,13.29c.72.34.39,1.42-.4,1.3l-34.65-5.08c-.58-.08-.99.54-.69,1.04l17.59,28.61c.42.69-.48,1.42-1.06.86l-22.96-22.03c-.41-.39-1.09-.15-1.16.41l-3.96,32.38c-.1.78-1.22.82-1.36.04l-5.76-32.08c-.1-.56-.81-.77-1.19-.34l-24.64,27.36c-.54.6-1.49-.05-1.13-.77l16.58-32.87c.26-.51-.18-1.1-.75-.99l-32.42,6.32c-.76.15-1.15-.89-.48-1.27l27.71-15.96c.48-.28.45-.98-.05-1.22L3.09,45.47c-.72-.34-.39-1.42.4-1.3l34.65,5.08c.58.08.99-.54.69-1.04l-17.59-28.61c-.42-.69.48-1.42,1.06-.86l22.96,22.03c.41.39,1.09.15,1.16-.41l3.96-32.38c.1-.78,1.22-.82,1.36-.04l5.76,32.08c.1.56.81.77,1.19.34Z"
          />
        </svg>
        <span style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-0.02em" }}>Vigili</span>
      </div>

      {/* middle: tagline */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <span
          style={{
            display: "flex",
            fontSize: 18,
            letterSpacing: "0.18em",
            color: "rgba(250,247,242,0.4)",
            textTransform: "uppercase",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          Coming soon
        </span>
        {/* satori は <br/> を解釈しない。flex column の 2 行に分ける。 */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 88,
            lineHeight: 1.02,
            letterSpacing: "-0.025em",
            fontWeight: 600,
            maxWidth: 980,
          }}
        >
          <span style={{ display: "flex" }}>Approve Claude Code</span>
          <span style={{ display: "flex" }}>from your phone.</span>
        </div>
      </div>

      {/* bottom: small description + url */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <span
          style={{
            display: "flex",
            fontSize: 22,
            color: "rgba(250,247,242,0.62)",
            maxWidth: 720,
            lineHeight: 1.35,
          }}
        >
          A local-first approval mesh. Push only the ambiguous middle to your pocket.
        </span>
        <span
          style={{
            display: "flex",
            fontSize: 18,
            letterSpacing: "0.12em",
            color: "#c16141",
            textTransform: "uppercase",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          vigili.io
        </span>
      </div>
    </div>,
    {
      ...size,
    },
  );
}
