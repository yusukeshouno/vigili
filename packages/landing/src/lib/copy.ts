/**
 * LP の文言を 1 か所に集約。
 * EN がデフォルト、JA は ?lang=ja で切替。
 *
 * トーン: minimal、direct、開発者向け。煽らない。
 */

export type Lang = "en" | "ja";

export interface Copy {
  // header
  navWaitlist: string;
  navGithub: string;
  langSwitchTo: string;

  // hero
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  heroWaitlistPlaceholder: string;
  heroWaitlistSubmit: string;
  heroWaitlistSubmitting: string;
  heroWaitlistSuccess: string;
  heroWaitlistError: string;
  heroFineprint: string;

  // surfaces (3 apps)
  surfacesEyebrow: string;
  surfacesTitle: string;
  surfaceMacAppName: string;
  surfaceMacAppBody: string;
  surfaceWidgetName: string;
  surfaceWidgetBody: string;
  surfacePhoneName: string;
  surfacePhoneBody: string;

  // showcase (3-step narrative)
  showcaseEyebrow: string;
  showcaseTitle: string;
  showcaseLead: string;
  showcaseStep1Title: string;
  showcaseStep1Body: string;
  showcaseStep2Title: string;
  showcaseStep2Body: string;
  showcaseStep3Title: string;
  showcaseStep3Body: string;

  // why
  whyEyebrow: string;
  whyTitle: string;
  whyBullets: Array<{ title: string; body: string }>;

  // how
  howEyebrow: string;
  howTitle: string;
  howSteps: Array<{ index: string; title: string; body: string }>;

  // security
  secEyebrow: string;
  secTitle: string;
  secBullets: Array<{ title: string; body: string }>;

  // footer
  footerTagline: string;
  footerOss: string;
  footerPrivacy: string;
  footerStatus: string;
}

const en: Copy = {
  navWaitlist: "Get notified",
  navGithub: "GitHub",
  langSwitchTo: "日本語",

  heroEyebrow: "Coming soon",
  heroTitle: "Approve Claude Code\nfrom your phone.",
  heroSubtitle:
    "A local-first approval mesh. Auto-allow the safe calls. Deny the dangerous ones. Push only the ambiguous middle to your pocket — two taps and Claude continues.",
  heroWaitlistPlaceholder: "you@example.com",
  heroWaitlistSubmit: "Notify me",
  heroWaitlistSubmitting: "Adding…",
  heroWaitlistSuccess: "Thanks. We'll email you the moment it ships.",
  heroWaitlistError: "Something went wrong. Try again?",
  heroFineprint: "No marketing, no sharing. One email when it's ready.",

  surfacesEyebrow: "Three surfaces, one queue",
  surfacesTitle: "Catch approvals wherever you happen to be.",
  surfaceMacAppName: "Mac app",
  surfaceMacAppBody:
    "Lives in your menu bar. One click reveals the pending card, allow or deny in place. The daemon keeps running even when the popover is closed.",
  surfaceWidgetName: "Mac widget",
  surfaceWidgetBody:
    "A desktop widget that glances at the queue without opening anything. Shows the pending count and today's auto-allowed total.",
  surfacePhoneName: "iPhone app",
  surfacePhoneBody:
    "Native iOS app with Live Activity in the Dynamic Island. Same queue as the Mac, two taps to approve, works on LAN or via relay when you're out.",

  showcaseEyebrow: "A 60-second tour",
  showcaseTitle: "From terminal to phone, in three steps.",
  showcaseLead:
    "Set it up once on your Mac. The next time Claude asks for permission, your phone is what you reach for.",
  showcaseStep1Title: "Pair your phone, once.",
  showcaseStep1Body:
    "Vigili's menu bar shows a QR code on first launch. Open Camera on your iPhone — paired in under five seconds. No accounts, no clouds in this step.",
  showcaseStep2Title: "Claude pauses. You don't.",
  showcaseStep2Body:
    "When Claude wants to do something the policy can't auto-decide, your phone wakes. The Dynamic Island shows what's waiting. No banner avalanches.",
  showcaseStep3Title: "Two taps. Continue.",
  showcaseStep3Body:
    "Open the app, glance at the full command, swipe Allow or Deny. Claude resumes in milliseconds. You go back to whatever you were doing.",

  whyEyebrow: "The problem",
  whyTitle: "Five Claude sessions, five places to babysit.",
  whyBullets: [
    {
      title: "Approval fatigue",
      body:
        "Every `Bash`, `Edit`, `WebFetch` prompts you for permission. Across 4–6 parallel sessions that's hundreds of prompts a day, and the only way to clear them is to be staring at the terminal.",
    },
    {
      title: "Context-switching tax",
      body:
        "You're in another window. You hear the bell. You switch back, squint at the diff, type 'yes'. Five times an hour. Each switch costs minutes of focus.",
    },
    {
      title: "Sleepy 'yes'",
      body:
        "Tired humans approve recklessly. The whole point of asking is lost. A tool that pushes everything to you isn't safety — it's noise.",
    },
  ],

  howEyebrow: "How it works",
  howTitle: "Classify, then route.",
  howSteps: [
    {
      index: "01",
      title: "Local policy decides",
      body:
        "A small daemon runs on your machine. Claude's PreToolUse hook routes every approval through it. Your `policy.yaml` matches read-only commands → allow, dangerous patterns → deny, the rest → ask.",
    },
    {
      index: "02",
      title: "Only 'ask' reaches you",
      body:
        "Allow and deny resolve in milliseconds — Claude keeps moving. The 'ask' bucket pushes to your phone via web push or Live Activity. Two taps to approve, swipe to deny.",
    },
    {
      index: "03",
      title: "The policy grows with you",
      body:
        "Each manual approval is a candidate rule. The daily digest surfaces patterns: 'You allowed 7 `git push` this week — promote?' One tap to fold it into your policy.",
    },
  ],

  secEyebrow: "Security",
  secTitle: "Your code never leaves the machine.",
  secBullets: [
    {
      title: "LAN-direct by default",
      body:
        "When your phone is on the same network, the Mac daemon talks to the iOS app directly over Bonjour. No relay, no cloud, no third party in the middle.",
    },
    {
      title: "Optional cloud relay for outside",
      body:
        "Away from your LAN? An optional managed relay routes by pairing-id without authenticating against your code. You can also self-host it — the relay is OSS.",
    },
    {
      title: "Fail-safe deny",
      body:
        "If the daemon dies or the policy file fails to parse, the gate exits with deny. We never auto-allow when the supervisor is down.",
    },
  ],

  footerTagline: "Approve Claude Code from your phone.",
  footerOss: "OSS on GitHub",
  footerPrivacy: "Privacy",
  footerStatus: "Status",
};

const ja: Copy = {
  navWaitlist: "通知を受け取る",
  navGithub: "GitHub",
  langSwitchTo: "English",

  heroEyebrow: "近日公開",
  heroTitle: "Claude Code の承認を\nスマホで。",
  heroSubtitle:
    "ローカル優先の承認メッシュ。安全な操作は自動許可、危険な操作は自動拒否、判断が要るものだけスマホに飛ぶ。2 タップで Claude が再開します。",
  heroWaitlistPlaceholder: "you@example.com",
  heroWaitlistSubmit: "通知を受け取る",
  heroWaitlistSubmitting: "登録中…",
  heroWaitlistSuccess: "ありがとうございます。リリース時にお知らせします。",
  heroWaitlistError: "うまく送れませんでした。再度お試しください。",
  heroFineprint: "送るのは公開時のメール 1 通だけ。それ以外には使いません。",

  surfacesEyebrow: "3 つの面、1 つのキュー",
  surfacesTitle: "今いる場所で承認を受け取る。",
  surfaceMacAppName: "Mac アプリ",
  surfaceMacAppBody:
    "メニューバーに常駐。クリックで pending カードが開き、その場で Allow/Deny。popover を閉じても daemon は走り続ける。",
  surfaceWidgetName: "Mac ウィジェット",
  surfaceWidgetBody:
    "アプリを開かずにキューの状況を見るデスクトップウィジェット。pending 件数 + 今日の自動許可数が一目でわかる。",
  surfacePhoneName: "iPhone アプリ",
  surfacePhoneBody:
    "ネイティブ iOS アプリ。Dynamic Island に Live Activity、Mac と同じキューを 2 タップで承認、LAN でも外出時の relay でも動く。",

  showcaseEyebrow: "60 秒で見るツアー",
  showcaseTitle: "ターミナルから、スマホまで、3 ステップ。",
  showcaseLead:
    "セットアップは Mac で 1 回だけ。次に Claude が承認を求めた瞬間、自然に手が伸びるのはスマホになる。",
  showcaseStep1Title: "スマホを 1 回だけ繋ぐ。",
  showcaseStep1Body:
    "Vigili を起動すると menu bar に QR が出る。iPhone の Camera で読むだけで 5 秒以内に接続完了。アカウント不要、この段階ではクラウドも経由しない。",
  showcaseStep2Title: "Claude が止まる。あなたは止まらない。",
  showcaseStep2Body:
    "ポリシーで判断できないツール呼び出しが来た瞬間、スマホが起きる。Dynamic Island に「何が待っているか」が出る。バナー連打にはしない。",
  showcaseStep3Title: "2 タップ。続行。",
  showcaseStep3Body:
    "アプリを開いて、コマンドの全文を見て、Allow か Deny をスワイプ。Claude はミリ秒で再開、あなたは元の作業に戻る。",

  whyEyebrow: "解決したい問題",
  whyTitle: "5 つの Claude セッション、5 つの監視ポイント。",
  whyBullets: [
    {
      title: "承認疲れ",
      body:
        "`Bash`/`Edit`/`WebFetch` のたびに許可を求められる。4〜6 並列なら 1 日数百件。ターミナルの前にいる時しか捌けない。",
    },
    {
      title: "コンテキストスイッチ税",
      body:
        "別ウィンドウで作業中。ベルが鳴る。戻って diff を見て 'yes' と打つ。1 時間 5 回。1 回ごとに分単位で集中が削られる。",
    },
    {
      title: "眠い時の 'yes'",
      body:
        "疲れた人間は雑に許可する。聞く意味が失われる。全部投げてくるツールは安全装置ではなくただのノイズ。",
    },
  ],

  howEyebrow: "仕組み",
  howTitle: "分類してから振り分ける。",
  howSteps: [
    {
      index: "01",
      title: "ローカル policy が判定",
      body:
        "小さな daemon が常駐し、Claude の PreToolUse hook を捕まえる。`policy.yaml` が read-only → allow、危険 → deny、それ以外 → ask に振り分ける。",
    },
    {
      index: "02",
      title: "ask だけがスマホに",
      body:
        "allow と deny は数ミリ秒で解決され、Claude は止まらない。ask だけが Web Push / Live Activity でスマホに届く。2 タップで承認、スワイプで拒否。",
    },
    {
      index: "03",
      title: "policy が育つ",
      body:
        "手で承認した記録から候補ルールを抽出。日次ダイジェストが「今週 git push を 7 回許可しています、ルール化しますか?」と提案する。1 タップで採用。",
    },
  ],

  secEyebrow: "セキュリティ",
  secTitle: "コードは端末から出ない。",
  secBullets: [
    {
      title: "LAN 直結が既定",
      body:
        "同一ネットワークにいる時は Mac daemon と iOS app が Bonjour で直結。relay もクラウドも介在しない。",
    },
    {
      title: "外出時は relay (任意)",
      body:
        "LAN から離れた時のみ管理 relay を経由。pairing-id でルーティングするだけで、コードに対する認証はしない。relay は OSS なので自前運用も可。",
    },
    {
      title: "落ちたら deny",
      body:
        "daemon が落ちたり policy が壊れていたら gate は deny で抜ける。監視役が居ない時に自動許可することは絶対にない。",
    },
  ],

  footerTagline: "Claude Code の承認をスマホで。",
  footerOss: "GitHub で OSS 公開",
  footerPrivacy: "プライバシー",
  footerStatus: "ステータス",
};

export function getCopy(lang: Lang): Copy {
  return lang === "ja" ? ja : en;
}
