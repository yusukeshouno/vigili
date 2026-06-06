/**
 * Quick Start セクション — 3ステップでセットアップ完了を示す。
 * Hero 直下に配置してユーザーを迷わせない。
 */
export function QuickStart() {
  const steps = [
    {
      num: "1",
      title: "Install on Mac",
      code: "brew install --cask vigili",
      body: "Or download the .dmg and drag to Applications. Vigili adds the Claude Code hook on first launch — nothing else to configure.",
    },
    {
      num: "2",
      title: "Every Claude window is now in the loop",
      code: null,
      body: "Vigili sits in your menu bar. Every Claude Code session on your Mac routes its approval requests through Vigili automatically.",
    },
    {
      num: "3",
      title: "Pair your iPhone in one tap",
      code: null,
      body: "Sign in with Apple on Mac and iPhone using the same Apple ID. Approvals appear on your phone instantly — no QR, no token, no terminal.",
    },
  ] as const;

  return (
    <section className="qs" id="quickstart">
      <div className="wrap">
        <span className="eyebrow">Get started</span>
        <h2 className="qs-title">Up and running in 2 minutes.</h2>
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
