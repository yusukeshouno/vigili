import type { Copy } from "@/lib/copy";
import { Sparkle, VigiliMark } from "./Sparkle";

export function Surfaces({ copy }: { copy: Copy }) {
  return (
    <section id="views">
      <div className="wrap">
        <div className="s-head">
          <div className="l">
            <span className="eyebrow">{copy.surfacesEyebrow}</span>
            <h2 style={{ marginTop: 18 }}>{copy.surfacesTitle}</h2>
          </div>
          <div className="r">{copy.surfacesLead}</div>
        </div>

        <div className="views">
          {/* Mac app */}
          <div className="view-card">
            <div className="view-stage">
              <Sparkle className="deco-sparkle" style={{ top: 18, left: 18, width: 30, height: 30 }} />
              <Sparkle
                className="deco-sparkle"
                style={{ bottom: 14, right: 18, width: 20, height: 20, opacity: 0.2 }}
              />
              <div className="menubar-icon">
                <Sparkle width={11} height={11} style={{ color: "var(--color-coral)" }} />
                <span className="badge">4</span>
              </div>
              <div className="mini-menubar">
                <div className="topbar">
                  <div style={{ display: "flex", gap: 3 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#E96D5C", display: "block" }} />
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#E9C04A", display: "block" }} />
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#54C56C", display: "block" }} />
                  </div>
                  <span style={{ marginLeft: "auto" }}>vigili</span>
                </div>
                <div className="row">
                  <div>
                    <div className="pr">
                      <b>vigili-core</b>
                    </div>
                    <div className="cmd">rm -rf ./.cache</div>
                  </div>
                  <span className="b">!</span>
                </div>
                <div className="row">
                  <div>
                    <div className="pr">
                      <b>marketing-site</b>
                    </div>
                    <div className="cmd">git push origin</div>
                  </div>
                </div>
                <div className="row">
                  <div>
                    <div className="pr">
                      <b>api-gateway</b>
                    </div>
                    <div className="cmd">npm install …</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="view-body">
              <div className="label">{copy.surfaceMacAppLabel}</div>
              <h3>{copy.surfaceMacAppHeadline}</h3>
              <p>{copy.surfaceMacAppBody}</p>
            </div>
          </div>

          {/* Widget */}
          <div className="view-card">
            <div className="view-stage">
              <Sparkle className="deco-sparkle" style={{ top: 24, right: 24, width: 24, height: 24 }} />
              <Sparkle
                className="deco-sparkle"
                style={{ bottom: 18, left: 24, width: 36, height: 36, opacity: 0.18 }}
              />
              <div className="widget">
                <div className="topbar">
                  <VigiliMark size={22} />
                  <span className="nm">Vigili</span>
                </div>
                <div>
                  <div className="big">
                    4<sub>waiting</sub>
                  </div>
                  <div className="lbl">across 3 sessions</div>
                </div>
                <div className="bar">
                  <i />
                </div>
                <div className="auto">42 auto-approved today</div>
              </div>
            </div>
            <div className="view-body">
              <div className="label">{copy.surfaceWidgetLabel}</div>
              <h3>{copy.surfaceWidgetHeadline}</h3>
              <p>{copy.surfaceWidgetBody}</p>
            </div>
          </div>

          {/* iPhone */}
          <div className="view-card">
            <div className="view-stage">
              <Sparkle className="deco-sparkle" style={{ top: 16, left: 24, width: 22, height: 22 }} />
              <Sparkle
                className="deco-sparkle"
                style={{ bottom: 18, right: 18, width: 32, height: 32, opacity: 0.2 }}
              />
              <div className="mini-phone">
                <div className="scr">
                  <div className="di">
                    <div className="b">
                      <Sparkle />
                    </div>
                    <div className="t">
                      <b>Vigili</b>3 waiting
                    </div>
                    <span className="n">3</span>
                  </div>
                  <div className="li">
                    <div className="it">
                      <p>vigili-core</p>
                      <span className="mc">rm -rf ./.cache</span>
                    </div>
                    <div className="it">
                      <p>marketing-site</p>
                      <span className="mc">git push origin</span>
                    </div>
                    <div className="it">
                      <p>api-gateway</p>
                      <span className="mc">npm install …</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="view-body">
              <div className="label">{copy.surfacePhoneLabel}</div>
              <h3>{copy.surfacePhoneHeadline}</h3>
              <p>{copy.surfacePhoneBody}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
