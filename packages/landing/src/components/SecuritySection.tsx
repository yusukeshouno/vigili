import type { Copy } from "@/lib/copy";

export function SecuritySection({ copy }: { copy: Copy }) {
  return (
    <section id="security">
      <div className="wrap">
        <div className="s-head">
          <div className="l">
            <span className="eyebrow">{copy.secEyebrow}</span>
            <h2 style={{ marginTop: 18 }}>{copy.secTitle}</h2>
          </div>
          <div className="r">{copy.secLead}</div>
        </div>

        <div className="sec-grid">
          <div className="sec-card">
            <div className="icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
            </div>
            <h3>{copy.sec1Title}</h3>
            <p>{copy.sec1Body}</p>
          </div>
          <div className="sec-card">
            <div className="icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </div>
            <h3>{copy.sec2Title}</h3>
            <p>{copy.sec2Body}</p>
          </div>
          <div className="sec-card">
            <div className="icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3>{copy.sec3Title}</h3>
            <p>{copy.sec3Body}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
