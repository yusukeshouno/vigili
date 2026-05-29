import type { Copy, Lang } from "@/lib/copy";
import { Sparkle } from "./Sparkle";
import { WaitlistForm } from "./WaitlistForm";

/**
 * Hero. 右側は実際の動作デモ動画を再生する。
 *
 * 動画ファイルは public/ 配下に置く想定:
 *  - public/hero.mp4   (H.264 必須)
 *  - public/hero.webm  (VP9 / AV1 任意 — Chrome 系で軽くなる)
 *  - public/hero-poster.jpg  (再生開始前の poster)
 *
 * 動画は autoPlay + muted + loop + playsInline で UA 制限を回避。
 */
export function Hero({ lang, copy }: { lang: Lang; copy: Copy }) {
  return (
    <section className="hero" id="top">
      <Sparkle
        className="bg-sparkle"
        style={{ top: 80, right: "8%", width: 380, height: 380, transform: "rotate(8deg)" }}
      />
      <div className="wrap">
        <div className="h-l">
          <span className="pill">
            <span className="dot" />
            {copy.heroPill}
          </span>
          <h1 className="h-title">
            <span style={{ display: "block" }}>{copy.heroTitleLeft}</span>
            <span style={{ display: "block" }}>
              <em>{copy.heroTitleEm}</em>
              {copy.heroTitleRight}
            </span>
          </h1>
          <p className="lead h-sub">{copy.heroSubtitle}</p>
          <div id="waitlist">
            <WaitlistForm lang={lang} copy={copy} />
          </div>
        </div>

        <div className="stage">
          <Sparkle className="sp twinkle s1" />
          <Sparkle className="sp s2" />
          <Sparkle className="sp twinkle delay s3" />

          <div className="hero-video">
            <Sparkle
              className="deco-sparkle"
              style={{ top: 30, left: -16, width: 30, height: 30, opacity: 0.4 }}
            />
            <Sparkle
              className="deco-sparkle"
              style={{ bottom: 60, right: -20, width: 22, height: 22, opacity: 0.32 }}
            />
            <div className="hero-video-frame">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                aria-label="Vigili demo"
              >
                <source src="/screenshots/queue-loop.webm" type="video/webm" />
                <source src="/screenshots/queue-loop.mp4" type="video/mp4" />
              </video>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
