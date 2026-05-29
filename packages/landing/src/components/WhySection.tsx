import type { Copy } from "@/lib/copy";

/**
 * 「The problem」セクション。暗背景 + 3 つの problem card + 図解 illustration。
 */
export function WhySection({ copy }: { copy: Copy }) {
  return (
    <section className="problem" id="why">
      <div className="wrap" style={{ position: "relative" }}>
        <div className="s-head">
          <div className="l">
            <span className="eyebrow">{copy.problemEyebrow}</span>
            <h2 style={{ marginTop: 18 }}>{copy.problemTitle}</h2>
          </div>
          <div className="r">{copy.problemLead}</div>
        </div>
        <div className="problem-grid">
          {/* Card 1: terminal whack-a-mole */}
          <div className="pcard">
            <div className="label">{copy.problemCard1Label}</div>
            <h3>{copy.problemCard1Title}</h3>
            <p>{copy.problemCard1Body}</p>
            <div className="ill">
              <div className="ill-terms">
                <div className="t">idle</div>
                <div className="t wait">wait</div>
                <div className="t">idle</div>
                <div className="t wait">wait</div>
                <div className="t">idle</div>
              </div>
            </div>
          </div>
          {/* Card 2: scattered → core */}
          <div className="pcard">
            <div className="label">{copy.problemCard2Label}</div>
            <h3>{copy.problemCard2Title}</h3>
            <p>{copy.problemCard2Body}</p>
            <div className="ill">
              <div className="ill-scatter">
                <span className="dot" style={{ top: 10, left: 14 }} />
                <span className="dot" style={{ top: 42, left: 32 }} />
                <span className="dot" style={{ bottom: 10, left: 60 }} />
                <span className="dot" style={{ top: 18, left: 100 }} />
                <span className="dot" style={{ bottom: 18, left: 128 }} />
                <svg
                  style={{
                    position: "absolute",
                    left: 150,
                    top: 38,
                    color: "rgba(251,248,240,0.3)",
                  }}
                  width="40"
                  height="2"
                  viewBox="0 0 40 2"
                  aria-hidden
                >
                  <line x1="0" y1="1" x2="40" y2="1" stroke="currentColor" strokeDasharray="3 3" />
                </svg>
                <div className="core">4</div>
              </div>
            </div>
          </div>
          {/* Card 3: yes fatigue */}
          <div className="pcard">
            <div className="label">{copy.problemCard3Label}</div>
            <h3>{copy.problemCard3Title}</h3>
            <p>{copy.problemCard3Body}</p>
            <div className="ill">
              <div className="ill-ticks">
                <span className="y">yes</span>
                <span className="y">yes</span>
                <span className="y">yes</span>
                <span>y</span>
                <span>y</span>
                <span>y</span>
                <span>y</span>
                <span>y</span>
                <span style={{ opacity: 0.2 }}>y</span>
                <span style={{ opacity: 0.2 }}>y</span>
                <span style={{ opacity: 0.15 }}>…</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
