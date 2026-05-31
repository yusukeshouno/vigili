import type { Copy } from "@/lib/copy";
import { Sparkle } from "./Sparkle";

/**
 * "How it works" — 3 行のレイアウトで、各行に図解。
 *  01 flow diagram (windows → hub → mac/iphone)
 *  02 rule grid (4 sample rules with allow/deny tags)
 *  03 funnel diagram (incoming → auto-allow → auto-deny → you)
 */
export function HowSection({ copy }: { copy: Copy }) {
  return (
    <section id="how">
      <div className="wrap">
        <div className="s-head">
          <div className="l">
            <span className="eyebrow">{copy.howEyebrow}</span>
            <h2 style={{ marginTop: 18 }}>{copy.howTitle}</h2>
          </div>
          <div className="r">{copy.howLead}</div>
        </div>

        <div className="how-grid">
          {/* Row 1: flow diagram */}
          <div className="how-row">
            <div className="n">01 / 03</div>
            <div className="l">
              <h3>{copy.howStep1Title}</h3>
              <p>{copy.howStep1Body}</p>
            </div>
            <div className="r">
              <div className="diag-flow">
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="win">window 1</div>
                  <div className="win">window 2</div>
                  <div className="win">window 3</div>
                </div>
                <span className="arrow">→</span>
                <div className="hub">
                  <Sparkle width={34} height={34} />
                </div>
                <span className="arrow">→</span>
                <div className="out">
                  <div className="o">
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                    </svg>
                    Mac
                  </div>
                  <div className="o">
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      aria-hidden
                    >
                      <rect x="7" y="2" width="10" height="20" rx="2" />
                    </svg>
                    iPhone
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: rule grid */}
          <div className="how-row">
            <div className="n">02 / 03</div>
            <div className="l">
              <h3>{copy.howStep2Title}</h3>
              <p>{copy.howStep2Body}</p>
            </div>
            <div className="r">
              <div className="diag-rules">
                <div className="rl allow">
                  <div className="tag">Default · Allow</div>
                  <div className="cmd">read *</div>
                </div>
                <div className="rl deny">
                  <div className="tag">Default · Deny</div>
                  <div className="cmd">rm -rf /</div>
                </div>
                <div className="rl allow">
                  <div className="tag">Today · Allow</div>
                  <div className="cmd">npm test</div>
                </div>
                <div className="rl allow">
                  <div className="tag">Today · Allow</div>
                  <div className="cmd">git status</div>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: funnel */}
          <div className="how-row last" style={{ borderBottom: 0 }}>
            <div className="n">03 / 03</div>
            <div className="l">
              <h3>{copy.howStep3Title}</h3>
              <p>{copy.howStep3Body}</p>
            </div>
            <div className="r">
              <div className="diag-funnel">
                <div className="row">
                  <span className="lbl">incoming</span>
                  <div
                    className="bar"
                    style={{ width: 240, background: "rgba(217,119,87,0.25)" }}
                  />
                  <span className="pct">100%</span>
                </div>
                <div className="row">
                  <span className="lbl">auto-allow</span>
                  <div className="bar" style={{ width: 160, background: "var(--color-sage)" }} />
                  <span className="pct">~70%</span>
                </div>
                <div className="row">
                  <span className="lbl">auto-deny</span>
                  <div className="bar" style={{ width: 40, background: "var(--color-plum)" }} />
                  <span className="pct">~20%</span>
                </div>
                <div className="row">
                  <span className="lbl">→ you</span>
                  <div className="bar" style={{ width: 24, background: "var(--color-coral)" }} />
                  <span className="pct">5–15%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
