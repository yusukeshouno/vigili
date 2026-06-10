import type { Copy } from "@/lib/copy";

/**
 * Quick Start セクション — 3ステップでセットアップ完了を示す。
 * Hero 直下に配置してユーザーを迷わせない。文言は copy.ts (en/ja) から。
 */
export function QuickStart({ copy }: { copy: Copy }) {
  const steps = [
    {
      num: "1",
      title: copy.qsStep1Title,
      code: "brew install --cask vigili",
      body: copy.qsStep1Body,
    },
    {
      num: "2",
      title: copy.qsStep2Title,
      code: null,
      body: copy.qsStep2Body,
    },
    {
      num: "3",
      title: copy.qsStep3Title,
      code: null,
      body: copy.qsStep3Body,
    },
  ] as const;

  return (
    <section className="qs" id="quickstart">
      <div className="wrap">
        <span className="eyebrow">{copy.qsEyebrow}</span>
        <h2 className="qs-title">{copy.qsTitle}</h2>
        <div className="qs-steps">
          {steps.map((s) => (
            <div className="qs-step" key={s.num}>
              <span className="qs-num">{s.num}</span>
              <div className="qs-body">
                <h3>{s.title}</h3>
                {s.code && (
                  <div className="qs-code">
                    <code>{s.code}</code>
                  </div>
                )}
                <p>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
