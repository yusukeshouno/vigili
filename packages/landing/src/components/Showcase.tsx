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
          {/* Step 1: QR pairing */}
          <div className="step">
            <div className="n">
              STEP <b>01</b>
            </div>
            <div className="ill">
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <div className="qr">
                  {qrPattern.flatMap((row, ri) =>
                    row
                      .split("")
                      .map((ch, ci) => (
                        <i key={`${ri}-${ci}`} className={ch === "b" ? "b" : undefined} />
                      )),
                  )}
                </div>
                <div className="qr-side">
                  <div>Pair this device</div>
                  <div>
                    <b>&lt; 5 sec</b>
                  </div>
                  <div>no account</div>
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
