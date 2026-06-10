import type { Copy } from "@/lib/copy";

// Mac の DMG は GitHub Releases の latest にホストする。
// リリースを切るたびに /latest/download/Vigili.dmg が最新を指す
// (versioned asset とは別に安定名 Vigili.dmg を毎リリースに添付する運用)。
const MAC_DMG_URL = "https://github.com/yusukeshouno/vigili/releases/latest/download/Vigili.dmg";
const MAC_VERSION_LABEL = "v1.0.0 · macOS 13+";
// iPhone は App Store 公開後に true へ。それまでは coming soon (死にリンク回避)。
const IPHONE_AVAILABLE = false;

export function DownloadCTA({
  copy,
  variant = "light",
}: {
  copy: Copy;
  variant?: "light" | "dark";
}) {
  return (
    <div className={`dl-cta dl-cta-${variant}`}>
      {/* Primary buttons */}
      <div className="dl-btns">
        <a href={MAC_DMG_URL} className="dl-btn dl-btn-primary" download>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
          </svg>
          {copy.dlMacButton}
          <span className="dl-version">{MAC_VERSION_LABEL}</span>
        </a>
        {IPHONE_AVAILABLE ? (
          <a
            href="https://apps.apple.com/app/vigili"
            className="dl-btn dl-btn-ghost"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M17 2H7a5 5 0 0 0-5 5v10a5 5 0 0 0 5 5h10a5 5 0 0 0 5-5V7a5 5 0 0 0-5-5zm-5 17a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm6.5-10.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
            </svg>
            iPhone App
          </a>
        ) : (
          <span className="dl-btn dl-btn-ghost dl-btn-disabled" aria-disabled="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M17 2H7a5 5 0 0 0-5 5v10a5 5 0 0 0 5 5h10a5 5 0 0 0 5-5V7a5 5 0 0 0-5-5zm-5 17a6 6 0 1 1 0-12 6 6 0 0 1 0 12zm6.5-10.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
            </svg>
            {copy.dlIphoneSoon}
          </span>
        )}
      </div>

      <p className="dl-note">{copy.dlNote}</p>
    </div>
  );
}
