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
            d="M60.75 45.25 L86.35 25.94 C86.9 25.52 87.61 26.21 87.2 26.77 L68.43 52.77 C68.16 53.14 68.39 53.66 68.84 53.72 L101 58.17 C101.69 58.26 101.7 59.25 101.01 59.36 L68.91 64.48 C68.47 64.55 68.26 65.06 68.51 65.42 L83.51 86.77 C83.89 87.32 83.24 87.99 82.68 87.62 L61.03 73.07 C60.66 72.82 60.16 73.05 60.1 73.49 L55.73 105.77 C55.64 106.46 54.65 106.47 54.54 105.79 L49.34 73.63 C49.27 73.18 48.74 72.97 48.38 73.24 L22.78 92.55 C22.23 92.97 21.52 92.28 21.93 91.72 L40.69 65.73 C40.96 65.36 40.73 64.84 40.28 64.78 L4.48 60.32 C3.78 60.23 3.77 59.22 4.47 59.12 L40.2 53.99 C40.65 53.93 40.87 53.41 40.61 53.05 L25.62 31.72 C25.24 31.17 25.89 30.5 26.45 30.87 L48.1 45.41 C48.47 45.66 48.98 45.43 49.03 44.99 L53.4 11 C53.49 10.31 54.49 10.3 54.59 10.99 L59.8 44.85 C59.87 45.3 60.39 45.51 60.76 45.24 Z"
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
