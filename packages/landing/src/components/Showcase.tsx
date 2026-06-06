import type { Copy } from "@/lib/copy";
import { Sparkle } from "./Sparkle";

/**
 * "60-second tour" — 3 ステップを QR / Dynamic Island / ルールカード で図解する章。
 */
export function Showcase({ copy }: { copy: Copy }) {
  // QR ill: 49 マス (7x7) のパターン。元デザインの並びを保持。
  // ` ` (space) = filled cream, `b` = blank (paper through). 7 columns x 7 rows.
  const qrPattern = ["    b  ", " b    b", "  bb   ", "b b b b", "   b   ", "  b  b ", "       "];

  return (
    <section className="tour" id="tour">
      <div className="wrap">
        <div className="s-head">
          <div className="l">
            <span className="eyebrow">{copy.tourEyebrow}</span>
            <h2 style={{ marginTop: 18 }}>{copy.tourTitle}</h2>
          </div>
          <div className="r">{copy.tourLead}</div>
        </div>

        <div className="tour-grid">
          {/* Step 1: Sign in with Apple */}
          <div className="step">
            <div className="n">
              STEP <b>01</b>
            </div>
            <div className="ill">
              <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start", maxWidth: "100%" }}>
                {/* Apple sign-in button mockup */}
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    background: "#000",
                    color: "#fff",
                    borderRadius: 8,
                    padding: "9px 18px",
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: 0.1,
                    boxSizing: "border-box",
                    maxWidth: "100%",
                  }}
                >
                  <svg width="14" height="17" viewBox="0 0 14 17" fill="white" aria-hidden>
                    <path d="M13.23 12.27c-.28.62-.6 1.18-.97 1.7-.51.72-.93 1.22-1.25 1.49-.5.46-1.04.7-1.62.71-.41 0-.91-.12-1.48-.36-.58-.24-1.11-.36-1.6-.36-.51 0-1.06.12-1.64.36-.58.24-1.05.37-1.41.38-.56.02-1.11-.23-1.65-.75-.35-.3-.79-.82-1.32-1.57C.66 13.1.28 12.31.09 11.44c-.2-.92-.3-1.82-.3-2.68C-.21 7.38.08 6.4.68 5.6c.47-.63 1.1-1.12 1.89-1.48a5.5 5.5 0 0 1 2.8-.75c.55 0 1.27.17 2.17.5.89.33 1.46.5 1.71.5.19 0 .83-.2 1.92-.6.72-.26 1.33-.37 1.84-.33 1.36.11 2.38.64 3.05 1.61-1.21.73-1.81 1.76-1.8 3.07.01 1.02.38 1.87 1.1 2.54.33.31.7.55 1.1.73-.09.26-.18.5-.28.73zM9.65.86c0 .8-.29 1.55-.87 2.23-.7.82-1.55 1.3-2.47 1.22-.01-.1-.02-.19-.02-.29 0-.77.33-1.6.92-2.27.3-.34.67-.62 1.13-.85.45-.22.88-.34 1.28-.36.01.11.03.21.03.32z" />
                  </svg>
                  Sign in with Apple
                </div>
                <div
                  style={{
                    fontSize: 11,
                    opacity: 0.5,
                    paddingLeft: 2,
                  }}
                >
                  Mac · then iPhone · done
                </div>
              </div>
            </div>
            <h3>{copy.tourStep1Title}</h3>
            <p>{copy.tourStep1Body}</p>
          </div>

          {/* Step 2: phone takes over */}
          <div className="step">
            <div className="n">
              STEP <b>02</b>
            </div>
            <div className="ill">
              <div className="ill-di">
                <div className="b">
                  <Sparkle />
                </div>
                <div className="t">
                  <b>Vigili waiting</b>
                  <span>vigili-core · rm -rf</span>
                </div>
              </div>
            </div>
            <h3>{copy.tourStep2Title}</h3>
            <p>{copy.tourStep2Body}</p>
          </div>

          {/* Step 3: rule card */}
          <div className="step">
            <div className="n">
              STEP <b>03</b>
            </div>
            <div className="ill">
              <div className="rule-card">
                <div className="topbar">
                  <span>NEW RULE</span>
                  <span>✓ saved</span>
                </div>
                <div className="cmd">cat **/*.md</div>
                <div className="ttl">
                  expires in <b>24 h</b>
                </div>
              </div>
            </div>
            <h3>{copy.tourStep3Title}</h3>
            <p>{copy.tourStep3Body}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
