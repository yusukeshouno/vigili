/**
 * LP の文言を 1 か所に集約。
 * EN がデフォルト、JA は ?lang=ja で切替。
 *
 * Claude Design からの handoff デザインに準拠した richer な構成。
 */

export type Lang = "en" | "ja";

export interface Copy {
  // nav
  navProduct: string;
  navHow: string;
  navSecurity: string;
  navWaitlist: string;
  langSwitchTo: string;

  // hero
  heroPill: string;
  heroTitleLeft: string;
  heroTitleEm: string;
  heroTitleRight: string;
  heroSubtitle: string;
  heroWaitlistPlaceholder: string;
  heroWaitlistSubmit: string;
  heroWaitlistSubmitting: string;
  heroWaitlistSuccess: string;
  heroWaitlistError: string;
  heroFineprint: string;

  // surfaces
  surfacesEyebrow: string;
  surfacesTitle: string;
  surfacesLead: string;
  surfaceMacAppLabel: string;
  surfaceMacAppHeadline: string;
  surfaceMacAppBody: string;
  surfaceWidgetLabel: string;
  surfaceWidgetHeadline: string;
  surfaceWidgetBody: string;
  surfacePhoneLabel: string;
  surfacePhoneHeadline: string;
  surfacePhoneBody: string;

  // tour
  tourEyebrow: string;
  tourTitle: string;
  tourLead: string;
  tourStep1Title: string;
  tourStep1Body: string;
  tourStep2Title: string;
  tourStep2Body: string;
  tourStep3Title: string;
  tourStep3Body: string;

  // problem
  problemEyebrow: string;
  problemTitle: string;
  problemLead: string;
  problemCard1Label: string;
  problemCard1Title: string;
  problemCard1Body: string;
  problemCard2Label: string;
  problemCard2Title: string;
  problemCard2Body: string;
  problemCard3Label: string;
  problemCard3Title: string;
  problemCard3Body: string;

  // how it works
  howEyebrow: string;
  howTitle: string;
  howLead: string;
  howStep1Title: string;
  howStep1Body: string;
  howStep2Title: string;
  howStep2Body: string;
  howStep3Title: string;
  howStep3Body: string;

  // security
  secEyebrow: string;
  secTitle: string;
  secLead: string;
  sec1Title: string;
  sec1Body: string;
  sec2Title: string;
  sec2Body: string;
  sec3Title: string;
  sec3Body: string;

  // download CTA
  dlMacButton: string;
  dlIphoneSoon: string;
  dlNote: string;

  // quick start
  qsEyebrow: string;
  qsTitle: string;
  qsStep1Title: string;
  qsStep1Body: string;
  qsStep2Title: string;
  qsStep2Body: string;
  qsStep3Title: string;
  qsStep3Body: string;

  // footer
  footerEyebrow: string;
  footerTitle: string;
  footerPrivacy: string;
}

const en: Copy = {
  navProduct: "Product",
  navHow: "How it works",
  navSecurity: "Security",
  navWaitlist: "Download",
  langSwitchTo: "日本語",

  heroPill: "Available now for macOS · iPhone coming soon",
  // 行分割は <br /> ではなく `\n` で表現し、コンポーネント側で分割する。
  heroTitleLeft: "Five sessions.",
  heroTitleEm: "One list",
  heroTitleRight: " to approve.",
  heroSubtitle:
    "Running five Claude Code windows means five terminals to keep watching. Vigili pulls every approval request into one list — handled from the menu bar, or from your phone when you're away.",
  heroWaitlistPlaceholder: "you@studio.com",
  heroWaitlistSubmit: "Notify me",
  heroWaitlistSubmitting: "Adding…",
  heroWaitlistSuccess: "Thanks. We'll email you the moment it ships.",
  heroWaitlistError: "Something went wrong. Try again?",
  heroFineprint: "No marketing, no sharing. One email when it's ready.",

  surfacesEyebrow: "Three surfaces",
  surfacesTitle: "The same queue, on whichever screen is closest.",
  surfacesLead:
    "At your desk, across the room, or out the door — Vigili meets you where you are.",
  surfaceMacAppLabel: "Mac app",
  surfaceMacAppHeadline: "Every request, one menu-bar click away.",
  surfaceMacAppBody:
    "Work through every session's requests from the menu bar, with the full command visible before you decide.",
  surfaceWidgetLabel: "Mac widget",
  surfaceWidgetHeadline: "A glance is enough.",
  surfaceWidgetBody:
    "A desktop widget that shows how many requests are waiting — and how many Vigili silently handled for you today.",
  surfacePhoneLabel: "iPhone app",
  surfacePhoneHeadline: "For when you've stepped away.",
  surfacePhoneBody:
    "Approve from a meeting or on a walk; the window resumes the moment you tap. The waiting screen doubles as a daily ledger — auto-approved count, yesterday's comparison, a 14-day chart.",

  tourEyebrow: "What it feels like",
  tourTitle: "Two taps, from your pocket.",
  tourLead:
    "Once you're signed in, this is the entire experience — no terminal in sight.",
  tourStep1Title: "Link once with your Apple ID",
  tourStep1Body:
    "Sign in with Apple on the Mac, then on the iPhone. The two link in seconds — a QR fallback is there if you prefer.",
  tourStep2Title: "Your phone wakes up only when needed",
  tourStep2Body:
    "Dynamic Island shows what's waiting and which project it came from — no need to walk back to the terminal.",
  tourStep3Title: "Allow — or Always",
  tourStep3Body:
    "Allow unblocks that one request. Always also saves a rule, so the same pattern never interrupts you again.",

  problemEyebrow: "The problem",
  problemTitle: "Five Claude windows. Five places to keep checking.",
  problemLead:
    'Permission prompts were designed for one terminal. Run five Claude Code windows in parallel and the system breaks down — context loss, terminal whack-a-mole, "yes-fatigue." Vigili was built for that exact pattern.',
  problemCard1Label: "Today",
  problemCard1Title: "Constant terminal-switching",
  problemCard1Body:
    "Each Claude window freezes until you respond. With five running, you tab-hunt to find the one that's waiting, read it, type yes, switch back. The context loss adds up fast.",
  problemCard2Label: "Today",
  problemCard2Title: "No overview of what's blocked",
  problemCard2Body:
    "You have to visit each window one by one to learn which are waiting and which are still working. There is no single place to look.",
  problemCard3Label: "Today",
  problemCard3Title: "Approving without reading",
  problemCard3Body:
    "After the tenth interruption, you stop reading and just say yes. The prompt becomes noise — which defeats the entire point of asking.",

  howEyebrow: "How it works",
  howTitle: "Approval is a routing problem.",
  howLead:
    "Vigili sits between Claude Code and you, and sorts every approval request into one of three outcomes: auto-allow, auto-deny, or ask you.",
  howStep1Title: "Every window flows into one list",
  howStep1Body:
    "A local daemon intercepts approval requests from every Claude Code window on your Mac and normalizes them into a single queue. That queue is the one list you see everywhere — menu bar, widget, phone.",
  howStep2Title: "Rules decide the obvious — and grow as you use it",
  howStep2Body:
    "Sensible defaults auto-allow safe reads. Tap Always on an approval and a 24-hour rule covers the same pattern next time, so the list keeps shrinking. Destructive operations — deleting system folders, force-pushing to main — are always blocked, no matter what rules exist.",
  howStep3Title: "Only the genuinely unclear reaches you",
  howStep3Body:
    "What rules can't decide — typically 5–15% to start — is pushed to your phone. Answer from anywhere, and the window resumes instantly.",

  secEyebrow: "Security",
  secTitle: "Your code never leaves your machine.",
  secLead:
    "Your source files are never uploaded — only the approval prompt itself travels (the tool name and the command line being run). On the same network it stays fully local. And if the service ever fails, Claude waits; it never approves on its own.",
  sec1Title: "Same network? Direct connection.",
  sec1Body:
    "When your phone is on the same Wi-Fi as your Mac, they talk directly over your local network — nothing goes through the internet. No third party in the middle.",
  sec2Title: "Away from home? Vigili Cloud.",
  sec2Body:
    "Sign in with Apple on your Mac and iPhone once. Vigili's cloud relay forwards the approval prompt between your devices over TLS — the same payload your phone shows you (the command being run), never your source files, and nothing is stored at rest. End-to-end encryption so the relay can't read the prompt either is on the roadmap.",
  sec3Title: "If Vigili stops, Claude pauses.",
  sec3Body:
    "If something goes wrong with Vigili, Claude stops and waits. It never approves on its own when you're not watching. Every window stays blocked until you're back.",

  dlMacButton: "Download for Mac",
  dlIphoneSoon: "iPhone · coming soon",
  dlNote: "Free · macOS 13 Ventura or later · notarized by Apple",

  qsEyebrow: "Get started",
  qsTitle: "Up and running in 2 minutes.",
  qsStep1Title: "Install on Mac",
  qsStep1Body:
    "Download the .dmg and drag Vigili to Applications. The Claude Code hook is added on first launch — nothing else to configure.",
  qsStep2Title: "Sign in with Apple on the Mac",
  qsStep2Body:
    "One click in the menu bar app. From this moment, every Claude Code window on your Mac is in the loop.",
  qsStep3Title: "Sign in on your iPhone",
  qsStep3Body:
    "Same Apple ID, one tap — approvals reach your phone from then on. (The iPhone app is coming to the App Store soon.)",

  footerEyebrow: "Download now",
  footerTitle: "All your Claude sessions. One list to work through.",
  footerPrivacy: "Privacy",
};

const ja: Copy = {
  navProduct: "プロダクト",
  navHow: "仕組み",
  navSecurity: "セキュリティ",
  navWaitlist: "ダウンロード",
  langSwitchTo: "English",

  heroPill: "macOS 版公開中 · iPhone 版は近日",
  // 半角スペースを残すと word-break: keep-all が "1 " と "つのリスト" の間で折り返す。
  // JA 側は半角スペースを除去して 1 つの単位として扱う。
  heroTitleLeft: "5 セッション、",
  heroTitleEm: "ひとつのリスト",
  heroTitleRight: "で承認。",
  heroSubtitle:
    "5 つの Claude Code ウィンドウを動かしていると、5 か所を見張ることになります。Vigili は全承認リクエストを 1 つのリストにまとめ、Mac のメニューバーから、離席中はスマホから処理できます。",
  heroWaitlistPlaceholder: "you@studio.com",
  heroWaitlistSubmit: "通知を受け取る",
  heroWaitlistSubmitting: "登録中…",
  heroWaitlistSuccess: "ありがとうございます。リリース時にお知らせします。",
  heroWaitlistError: "うまく送れませんでした。再度お試しください。",
  heroFineprint: "送るのは公開時のメール 1 通だけ。それ以外には使いません。",

  surfacesEyebrow: "3 つの画面",
  surfacesTitle: "同じキューが、いちばん近くの画面に。",
  surfacesLead: "机の前でも、部屋の反対側でも、外出先でも — Vigili はそこにあります。",
  surfaceMacAppLabel: "Mac アプリ",
  surfaceMacAppHeadline: "全リクエストが、メニューバーの 1 クリック。",
  surfaceMacAppBody:
    "メニューバーから全セッションのリクエストを順に処理。実行されるコマンドの全文を読んでから決められます。",
  surfaceWidgetLabel: "Mac ウィジェット",
  surfaceWidgetHeadline: "見るだけで分かる。",
  surfaceWidgetBody:
    "いくつ待っているか、今日 Vigili が静かに処理した件数 — どちらも一目でわかるデスクトップウィジェット。",
  surfacePhoneLabel: "iPhone アプリ",
  surfacePhoneHeadline: "離席中はこちらで。",
  surfacePhoneBody:
    "会議中でも散歩中でも、タップした瞬間にウィンドウが再開。待機画面は 1 日の台帳を兼ねます — 今日の自動承認件数・前日比・14 日間のチャート。",

  tourEyebrow: "使い心地",
  tourTitle: "ポケットの中から、2 タップ。",
  tourLead: "サインインを済ませれば、体験はこれだけ。ターミナルは出てきません。",
  tourStep1Title: "Apple ID で 1 回リンクする",
  tourStep1Body:
    "Mac で「Apple でサインイン」、次に iPhone でも同じ操作。数秒でリンクされます。QR によるフォールバックもあります。",
  tourStep2Title: "必要なときだけ、スマホが起きる",
  tourStep2Body:
    "Dynamic Island に、何が待っているか・どのプロジェクトからかが表示されます。ターミナルに戻る必要はありません。",
  tourStep3Title: "Allow — または Always",
  tourStep3Body:
    "「Allow」はその 1 件を再開。「Always」はルールも保存し、同じパターンには二度と中断されなくなります。",

  problemEyebrow: "解決したい問題",
  problemTitle: "5 つの Claude ウィンドウ。5 か所を見張る問題。",
  problemLead:
    "承認 dialog は 1 つのターミナル用に設計されています。Claude Code を 5 つ並列で動かすと、文脈の喪失・ターミナル探し・「とにかく yes」と仕組みが破綻します。Vigili はまさにこの問題のために作られました。",
  problemCard1Label: "今",
  problemCard1Title: "ターミナル切り替えが止まらない",
  problemCard1Body:
    "各 Claude ウィンドウは応答するまで止まります。5 つ動かしていると、待っているウィンドウを探し、内容を読み、yes と打ち、元に戻る。文脈の損失はすぐに積み重なります。",
  problemCard2Label: "今",
  problemCard2Title: "何が止まっているか俯瞰できない",
  problemCard2Body:
    "どれが待っていて、どれがまだ動いているのか。各ウィンドウを 1 つずつ見て回るしかなく、全体を見渡せる場所がありません。",
  problemCard3Label: "今",
  problemCard3Title: "読まずに許可するようになる",
  problemCard3Body:
    "10 回目の中断で、内容を読まずに yes を押すようになります。確認を求める仕組みそのものが、形だけになってしまう。",

  howEyebrow: "仕組み",
  howTitle: "承認は、振り分けの問題。",
  howLead:
    "Vigili は Claude Code とあなたの間に立ち、すべての承認リクエストを「自動許可・自動拒否・人間に聞く」の 3 つに振り分けます。",
  howStep1Title: "全ウィンドウが 1 つのリストに流れ込む",
  howStep1Body:
    "ローカル常駐の daemon が、Mac 上のすべての Claude Code ウィンドウから承認リクエストを受け取り、1 つのキューに正規化します。メニューバー・ウィジェット・スマホで見えるリストは、すべてこのキューです。",
  howStep2Title: "明らかなものはルールが処理 — 使うほど育つ",
  howStep2Body:
    "「読み取りは許可」などのデフォルトが最初から入っています。承認時に「Always」を押すと同じパターンに 24 時間ルールが作られ、リストは日ごとに短くなります。システムフォルダ削除や main への force-push などの危険操作は、どんなルールを書いても常時ブロックされます。",
  howStep3Title: "本当に判断が必要なものだけ届く",
  howStep3Body:
    "ルールで決められないもの — 最初は全体の 5〜15% 程度 — だけがスマホに届きます。どこからでも答えられ、ウィンドウは即座に再開します。",

  secEyebrow: "セキュリティ",
  secTitle: "コードはあなたのパソコンから出ない。",
  secLead:
    "ソースファイルがアップロードされることはありません。流れるのは承認プロンプト自体（ツール名と実行されるコマンド行）だけです。同じネットワークなら完全にローカルで完結します。Vigili が止まっても、Claude は勝手に進まず待ちます。",
  sec1Title: "同じネットワークなら直接つながる",
  sec1Body:
    "スマホと Mac が同じ Wi-Fi にいるとき、両者はローカルネットワークで直接通信します。インターネットを経由しないので、間に第三者は入りません。",
  sec2Title: "外出先は Vigili Cloud 経由",
  sec2Body:
    "Mac と iPhone でそれぞれ「Apple でサインイン」するだけで設定完了。Vigili のクラウド relay が承認プロンプトをデバイス間で TLS 越しに転送します。流れるのはスマホに表示されるのと同じ内容（実行されるコマンド）だけで、ソースファイルは送られず、保存もされません。relay 自身もプロンプトを読めない end-to-end 暗号化はロードマップにあります。",
  sec3Title: "Vigili が止まったら、Claude も止まる",
  sec3Body:
    "Vigili に問題が起きた場合、Claude はその場で止まって待ちます。あなたが見ていないときに勝手に許可することは絶対にありません。すべてのウィンドウは復帰までブロックされたままです。",

  dlMacButton: "Mac 版をダウンロード",
  dlIphoneSoon: "iPhone · 近日公開",
  dlNote: "無料 · macOS 13 Ventura 以降 · Apple 公証済み",

  qsEyebrow: "はじめる",
  qsTitle: "2 分でセットアップ完了。",
  qsStep1Title: "Mac にインストール",
  qsStep1Body:
    ".dmg をダウンロードして Vigili を Applications にドラッグ。初回起動時に Claude Code の hook が自動で追加されます — ほかに設定するものはありません。",
  qsStep2Title: "Mac で Apple サインイン",
  qsStep2Body:
    "メニューバーアプリで 1 クリック。この瞬間から、Mac 上のすべての Claude Code ウィンドウが対象になります。",
  qsStep3Title: "iPhone でもサインイン",
  qsStep3Body:
    "同じ Apple ID でワンタップ。以後、承認はスマホに届きます。（iPhone アプリは App Store 公開準備中です。）",

  footerEyebrow: "ダウンロード",
  footerTitle: "全 Claude セッションを、1 つのリストで。",
  footerPrivacy: "プライバシー",
};

export function getCopy(lang: Lang): Copy {
  return lang === "ja" ? ja : en;
}
