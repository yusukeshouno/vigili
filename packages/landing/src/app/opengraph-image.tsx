import { ImageResponse } from "next/og";

/**
 * 動的 OG 画像 (1200x630)。
 * Twitter / Slack / Discord 等で URL を貼った時に表示される。
 *
 * Next.js のエッジレンダリングで生成 — 画像アセットを repo に置く必要なし。
 */

export const runtime = "edge";
export const alt = "Vigili — All your Claude Code sessions. One queue.";
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
            d="M57.7,43.49l27.2-32.6c.46-.55,1.32.04.97.67l-20.55,37.15c-.25.45.16.98.66.86l37.4-9.01c.68-.16,1.03.79.41,1.1l-33.5,16.96c-.45.23-.43.88.04,1.07l33.56,14.01c.66.27.36,1.26-.34,1.13l-36.59-7.24c-.5-.1-.88.44-.62.88l19.69,33.27c.36.61-.45,1.22-.94.71l-26.51-27.77c-.35-.37-.98-.15-1.02.36l-2.96,37.88c-.06.71-1.08.74-1.18.03l-5.07-37.64c-.07-.51-.71-.7-1.04-.3l-27.2,32.6c-.46.55-1.32-.04-.97-.67l20.55-37.15c.25-.45-.16-.98-.66-.86L1.62,77.95c-.68.16-1.03-.79-.41-1.1l33.5-16.96c.45-.23.43-.88-.04-1.07L1.11,44.81c-.66-.27-.36-1.26.34-1.13l36.59,7.24c.5.1.88-.44.62-.88L18.98,16.78c-.36-.61.45-1.22.94-.71l26.51,27.77c.35.37.98.15,1.02-.36l2.96-37.88c.06-.71,1.08-.74,1.18-.03l5.07,37.64c.07.51.71.7,1.04.3Z"
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
          <span style={{ display: "flex" }}>All your sessions.</span>
          <span style={{ display: "flex" }}>One queue.</span>
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
          Every Claude Code session's approvals in one queue. Auto-decide the routine, two-tap the rest.
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
