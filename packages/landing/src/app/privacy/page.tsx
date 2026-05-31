import Link from "next/link";
import type { Metadata } from "next";
import { Footer } from "@/components/Footer";
import { VigiliMark } from "@/components/Sparkle";
import { type Lang, getCopy } from "@/lib/copy";

export const metadata: Metadata = {
  title: "Privacy — Vigili",
  description: "What data Vigili collects, and what it doesn't.",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PrivacyPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const raw = params.lang;
  const lang: Lang = (Array.isArray(raw) ? raw[0] : raw) === "ja" ? "ja" : "en";
  const copy = getCopy(lang);

  return (
    <>
      {/* slim top bar */}
      <header
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "24px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Link href={`/?lang=${lang}`} className="brand">
          <VigiliMark size={24} />
          <span className="name">Vigili</span>
        </Link>
        <Link
          href={`/?lang=${lang}`}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--color-fg-3)",
          }}
        >
          ← {lang === "ja" ? "ホーム" : "home"}
        </Link>
      </header>

      <article
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "32px 24px 120px",
        }}
      >
        <span className="eyebrow">{lang === "ja" ? "プライバシー" : "Privacy"}</span>
        <h1 style={{ marginTop: 18, fontSize: "clamp(36px, 4vw, 56px)", lineHeight: 1.05 }}>
          {lang === "ja" ? "集めないものを明示する。" : "What we don't collect."}
        </h1>

        {lang === "ja" ? <PrivacyJa /> : <PrivacyEn />}

        <p style={{ marginTop: 48, fontSize: 11, color: "var(--color-fg-3)" }}>
          {lang === "ja" ? "最終更新: " : "Last updated: "}2026-05-26
        </p>
      </article>

      <Footer lang={lang} copy={copy} />
    </>
  );
}

// ----- EN -----

function PrivacyEn() {
  return (
    <div
      style={{
        marginTop: 40,
        display: "flex",
        flexDirection: "column",
        gap: 28,
        fontSize: 15,
        lineHeight: 1.7,
        color: "var(--color-fg-2)",
      }}
    >
      <Block title="What the Vigili daemon sees">
        <p>
          The daemon runs entirely on your machine. The only thing it intercepts is the input to
          each Claude Code tool call — the shell command, file path, or URL — plus a session
          identifier and current working directory. It does not see your conversation with Claude,
          Claude&apos;s responses, or the contents of files Claude reads.
        </p>
      </Block>
      <Block title="What stays local">
        <p>
          Approval decisions are stored in a SQLite database at <Code>~/.vigili/queue.db</Code>.
          Policy rules live in <Code>~/.vigili/policy.yaml</Code>. Both are owner-only (file mode
          0600) and never leave your machine unless you choose to use the cloud relay.
        </p>
      </Block>
      <Block title="What the optional cloud relay sees">
        <p>
          If you enable the managed relay at <Code>relay.vigili.io</Code> for outside-LAN access,
          the relay routes by pairing-id and sees the same approval payload your phone sees (the
          tool input, e.g. the command line being run). It does not store this payload — it only
          forwards in memory. End-to-end encryption between Mac and phone is on the roadmap.
        </p>
        <p>
          You can also self-host the relay — the code is OSS. In that case Vigili.io sees nothing.
        </p>
      </Block>
      <Block title="Waitlist">
        <p>
          If you enter your email on the landing page, we store it solely to send you a single
          notification when Vigili launches. No newsletters, no marketing, no third-party sharing.
          Unsubscribe by replying to that email or emailing
          <Code>privacy@vigili.io</Code> any time.
        </p>
      </Block>
      <Block title="Analytics">
        <p>
          Page visits are measured via Vercel Analytics in cookieless mode. We see aggregate counts
          (visits, referrers, browsers) but no personal identifiers and no cross-site tracking.
        </p>
      </Block>
      <Block title="Contact">
        <p>
          Questions: <Code>privacy@vigili.io</Code>.
        </p>
      </Block>
    </div>
  );
}

// ----- JA -----

function PrivacyJa() {
  return (
    <div
      style={{
        marginTop: 40,
        display: "flex",
        flexDirection: "column",
        gap: 28,
        fontSize: 15,
        lineHeight: 1.7,
        color: "var(--color-fg-2)",
      }}
    >
      <Block title="Vigili daemon が見ているもの">
        <p>
          daemon は完全にあなたの端末内で動作します。Claude Code の各ツール呼び出しの入力
          (シェルコマンド、ファイルパス、URL)、セッション識別子、作業ディレクトリだけを
          中継します。Claude との会話、Claude の応答、Claude が読んだファイルの中身は
          一切取得しません。
        </p>
      </Block>
      <Block title="ローカルに留まるデータ">
        <p>
          承認判定は SQLite (<Code>~/.vigili/queue.db</Code>) に保存。ポリシーは
          <Code>~/.vigili/policy.yaml</Code> に置かれます。どちらも所有者のみ読み書き可能 (0600)
          で、クラウド relay を利用しない限り端末外に送信されません。
        </p>
      </Block>
      <Block title="クラウド relay (任意) が見るもの">
        <p>
          外出先からの承認のために <Code>relay.vigili.io</Code> の managed relay を有効に
          した場合、relay は pairing-id でルーティングするだけで、スマホに届くのと同じ
          承認ペイロード (実行されようとしているコマンド等) を通します。relay は永続化せず、
          メモリ上で fan-out するだけです。Mac↔スマホ間の E2E 暗号化は今後の予定です。
        </p>
        <p>relay は OSS なので自前運用も可能です。その場合 Vigili.io は何も見ません。</p>
      </Block>
      <Block title="Waitlist について">
        <p>
          ランディングページでメールアドレスを入力された場合、リリース時に 1 通だけ通知を
          送るためにのみ使用します。ニュースレター、マーケティング配信、第三者提供は
          一切行いません。配信解除はその通知メールへの返信、または
          <Code>privacy@vigili.io</Code> までお知らせください。
        </p>
      </Block>
      <Block title="解析ツール">
        <p>
          Vercel Analytics の cookieless モードでページ訪問を計測しています。訪問数 / リファラ /
          ブラウザの集計データのみで、個人を識別する情報やサイトを跨いだ
          トラッキングは取得しません。
        </p>
      </Block>
      <Block title="お問い合わせ">
        <p>
          <Code>privacy@vigili.io</Code> までご連絡ください。
        </p>
      </Block>
    </div>
  );
}

// ----- shared block -----

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: 0, borderTop: 0 }}>
      <h2 style={{ fontSize: 20, color: "var(--color-fg)" }}>{title}</h2>
      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {children}
      </div>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        borderRadius: 4,
        background: "var(--color-surface)",
        border: "1px solid var(--color-rule)",
        padding: "1px 6px",
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        color: "var(--color-fg)",
      }}
    >
      {children}
    </code>
  );
}
