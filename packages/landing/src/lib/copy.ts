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

  heroPill: "Available now · macOS + iOS",
  // 行分割は <br /> ではなく `\n` で表現し、コンポーネント側で分割する。
  heroTitleLeft: "Five sessions.",
  heroTitleEm: "One list",
  heroTitleRight: " to approve.",
  heroSubtitle:
    "Running five Claude Code windows means five terminals to keep watching. Every permission prompt freezes a window, so you tab-hunt to find which. Vigili pulls every request into one list — handled from the menu bar, or your phone when you're away. Auto-rules grow as you use it, so the list keeps shrinking.",
  heroWaitlistPlaceholder: "you@studio.com",
  heroWaitlistSubmit: "Notify me",
  heroWaitlistSubmitting: "Adding…",
  heroWaitlistSuccess: "Thanks. We'll email you the moment it ships.",
  heroWaitlistError: "Something went wrong. Try again?",
  heroFineprint: "No marketing, no sharing. One email when it's ready.",

  surfacesEyebrow: "Three ways to see what's waiting",
  surfacesTitle: "All sessions, all requests, in one list.",
  surfacesLead:
    "Vigili gives you the same queue on every surface you already use — quietly in the menu bar, glanceable on the desktop, in your pocket when you walk away.",
  surfaceMacAppLabel: "Mac app",
  surfaceMacAppHeadline: "Every request, one menu-bar click away.",
  surfaceMacAppBody:
    "Every approval request across every Claude window, in a single list. Work through five sessions' worth from one place — no more tab-hunting.",
  surfaceWidgetLabel: "Mac widget",
  surfaceWidgetHeadline: "A glance is enough.",
  surfaceWidgetBody:
    "A desktop widget that shows how many requests are waiting — and how many Vigili silently handled for you today.",
  surfacePhoneLabel: "iPhone app",
  surfacePhoneHeadline: "For when you've stepped away.",
  surfacePhoneBody:
    "The same list, in your pocket. Dynamic Island shows the count — tap to approve in a meeting or on a walk. Sessions resume the moment you tap. The waiting screen shows today's auto-approved count, yesterday's comparison, and a 14-day activity chart.",

  tourEyebrow: "A 60-second tour",
  tourTitle: "Set up once. Every window included.",
  tourLead:
    "Install Vigili on your Mac and pair your phone once. From then on, every Claude Code window you open is already in the loop — no per-session setup.",
  tourStep1Title: "Sign in with Apple. Linked in seconds.",
  tourStep1Body:
    "Click 'Sign in with Apple' in the Mac menu bar app, then do the same on your iPhone. Both devices link to your Apple ID instantly — no QR, no terminal, no manual token. If you prefer, a QR fallback is still there.",
  tourStep2Title: "Step away. Your phone takes over.",
  tourStep2Body:
    "When a window stops on something your rules can't decide automatically, your phone wakes up. Dynamic Island shows what's waiting and which project — no need to walk back to the terminal.",
  tourStep3Title: "Tap to approve. The window resumes.",
  tourStep3Body:
    "Open the app and work through the list. Tap Allow to unblock that window. Tap Always and Vigili adds a 24-hour rule that auto-approves the same pattern. The list shrinks as the day goes on.",

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
    "You have to visit each window one by one. Vigili gives you a single list across sessions — visible from the menu bar at a glance.",
  problemCard3Label: "Today",
  problemCard3Title: "Approving without reading",
  problemCard3Body:
    "After the tenth interruption, you stop reading and say yes. The permission system is just friction. Auto-rules grow as you use Vigili, so fewer requests reach you in the first place.",

  howEyebrow: "How it works",
  howTitle: "Set up once. Works across every window.",
  howLead:
    "Vigili sits between Claude Code and you. Once installed, every window on your Mac routes its approvals through Vigili — no per-window setup, no Claude config to maintain.",
  howStep1Title: "Every Claude window flows through Vigili",
  howStep1Body:
    "Once installed, every Claude Code window on your Mac sends its approval requests through Vigili first. No matter how many windows you open — they're all visible in one place, on your Mac and on your phone.",
  howStep2Title: "Rules handle the obvious — and grow over time",
  howStep2Body:
    "Vigili ships with sensible defaults: reading files is always allowed. Tap Always on an approval and Vigili creates a rule for the same pattern — auto-expiring daily so stale allows don't accumulate. Dangerous operations like deleting system folders or force-pushing to main are always blocked, regardless of any rule you write.",
  howStep3Title: "Only genuinely unclear requests reach you",
  howStep3Body:
    "Requests your rules can't decide — typically 5–15% to start — get pushed to your phone. One list across all windows, worked through in order. Approve from your desk or while away. Either way, the windows resume.",

  secEyebrow: "Security",
  secTitle: "Your code stays on your machine.",
  secLead:
    "Vigili was built so a third party never sees your code or commands. Approvals flow as encrypted identifiers — never the source. And if the service ever fails, Claude waits; it never approves on its own.",
  sec1Title: "Same network? Direct connection.",
  sec1Body:
    "When your phone is on the same Wi-Fi as your Mac, they talk directly over your local network — nothing goes through the internet. No third party in the middle.",
  sec2Title: "Away from home? Vigili Cloud.",
  sec2Body:
    "Sign in with Apple on your Mac and iPhone once. Vigili's cloud relay forwards notifications and approvals between your devices — never storing your source code or commands. Your Apple ID links the devices; no manual token exchange needed.",
  sec3Title: "If Vigili stops, Claude pauses.",
  sec3Body:
    "If something goes wrong with Vigili, Claude stops and waits. It never approves on its own when you're not watching. Every window stays blocked until you're back.",

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

  heroPill: "公開中 · macOS + iOS",
  // 半角スペースを残すと word-break: keep-all が "1 " と "つのリスト" の間で折り返す。
  // JA 側は半角スペースを除去して 1 つの単位として扱う。
  heroTitleLeft: "5 セッション、",
  heroTitleEm: "ひとつのリスト",
  heroTitleRight: "で承認。",
  heroSubtitle:
    "5 つの Claude Code ウィンドウを動かしていると、5 か所を見張ることになります。リクエストのたびにウィンドウが止まり、どれが待っているかを探すために切り替え続ける。Vigili は全リクエストを 1 つのリストにまとめ、Mac のメニューバーから、離席中はスマホから処理できます。ルールは使うほど育ち、リストはどんどん短くなっていきます。",
  heroWaitlistPlaceholder: "you@studio.com",
  heroWaitlistSubmit: "通知を受け取る",
  heroWaitlistSubmitting: "登録中…",
  heroWaitlistSuccess: "ありがとうございます。リリース時にお知らせします。",
  heroWaitlistError: "うまく送れませんでした。再度お試しください。",
  heroFineprint: "送るのは公開時のメール 1 通だけ。それ以外には使いません。",

  surfacesEyebrow: "3 つの見え方",
  surfacesTitle: "全セッションの承認を、1 つのリストで。",
  surfacesLead:
    "Vigili は同じキューを、あなたが既に使っている画面に届けます。メニューバーで静かに、デスクトップで一目で、ポケットの中で離席中も。",
  surfaceMacAppLabel: "Mac アプリ",
  surfaceMacAppHeadline: "全リクエストが、メニューバーの 1 クリック。",
  surfaceMacAppBody:
    "全ウィンドウの承認リクエストが 1 つのリストに。5 セッション分を 1 か所で処理 — ターミナルを探す必要はもうない。",
  surfaceWidgetLabel: "Mac ウィジェット",
  surfaceWidgetHeadline: "見るだけで分かる。",
  surfaceWidgetBody:
    "いくつ待っているか、今日 Vigili が静かに処理した件数 — どちらも一目でわかるデスクトップウィジェット。",
  surfacePhoneLabel: "iPhone アプリ",
  surfacePhoneHeadline: "離席中はこちらで。",
  surfacePhoneBody:
    "同じリストをポケットに。Dynamic Island に待ち件数が表示され、会議中・散歩中でもタップで承認。タップした瞬間にセッションが再開します。待機画面には今日の自動承認件数・前日比・14 日間のアクティビティチャートが表示されます。",

  tourEyebrow: "60 秒で見るツアー",
  tourTitle: "1 回セットアップ。全ウィンドウが対象になる。",
  tourLead:
    "Mac にインストールしてスマホとペアリングするだけ。以後、開く Claude Code ウィンドウはすべて自動で対象になります。",
  tourStep1Title: "Apple ID でサインイン。数秒でリンク完了。",
  tourStep1Body:
    "Mac メニューバーアプリで「Apple でサインイン」をクリック、次に iPhone アプリでも同じ操作をするだけ。同じ Apple ID で両デバイスが自動でリンクされます。QR もターミナルもトークン手入力も不要。QR によるフォールバックも残っています。",
  tourStep2Title: "席を離れる。スマホが代わりに教えてくれる。",
  tourStep2Body:
    "ルールで判断できないリクエストが来ると、スマホが起きます。Dynamic Island に何が待っているか・どのプロジェクトからかが出るので、ターミナルに戻る必要はありません。",
  tourStep3Title: "タップで承認。ウィンドウが再開する。",
  tourStep3Body:
    "アプリを開いてリストを処理します。「Allow」でそのウィンドウを再開、「Always」を押せば同じパターンに 24 時間ルールが作られ、自動承認されるようになります。リストは日が進むほど短くなっていきます。",

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
    "各ウィンドウを 1 つずつ見るしかありません。Vigili は全セッションを横断する 1 つのリストを、メニューバーから一目で確認できるようにします。",
  problemCard3Label: "今",
  problemCard3Title: "読まずに許可するようになる",
  problemCard3Body:
    "10 回目の中断で、内容を読まずに yes を押すようになります。承認という仕組みは形だけになります。Vigili のルールは使うほど育つので、人間に届くリクエストの数が減っていきます。",

  howEyebrow: "仕組み",
  howTitle: "1 回セットアップ。全ウィンドウに効く。",
  howLead:
    "Vigili は Claude Code とあなたの間に立ちます。一度インストールすれば、Mac 上のすべてのウィンドウが承認を Vigili 経由で流します — ウィンドウごとの設定も、Claude 側の設定維持も不要です。",
  howStep1Title: "全 Claude ウィンドウが Vigili を経由する",
  howStep1Body:
    "Mac にインストールすると、すべての Claude Code ウィンドウの承認リクエストが Vigili に流れます。Mac でもスマホでも、横断的に 1 つのリストで見られます。",
  howStep2Title: "明らかなものはルールが処理 — そして育つ",
  howStep2Body:
    "最初から「読み取りは許可」などのデフォルトが入っています。承認時に「Always」を押すと同じパターンに毎日自動失効するルールが作られます。システムフォルダ削除や main への force-push などの危険操作は、どんなルールを書いても常時ブロックされます。",
  howStep3Title: "本当に判断が必要なものだけ届く",
  howStep3Body:
    "ルールで決められないリクエスト — 最初は全体の 5〜15% 程度 — がスマホに届きます。全ウィンドウ横断の 1 リストを順に処理。机からでも離席中でも承認でき、どちらでもウィンドウが再開します。",

  secEyebrow: "セキュリティ",
  secTitle: "コードはあなたのパソコンから出ない。",
  secLead:
    "Vigili は第三者があなたのコードやコマンドを見ない設計です。承認リクエストは暗号化された識別子として流れ、ソースコードは送信されません。Vigili が止まっても、Claude は勝手に進まず待ちます。",
  sec1Title: "同じネットワークなら直接つながる",
  sec1Body:
    "スマホと Mac が同じ Wi-Fi にいるとき、両者はローカルネットワークで直接通信します。インターネットを経由しないので、間に第三者は入りません。",
  sec2Title: "外出先は Vigili Cloud 経由",
  sec2Body:
    "Mac と iPhone でそれぞれ「Apple でサインイン」するだけで設定完了。Vigili のクラウド relay がデバイス間で通知と承認を転送します。ソースコードや承認内容は保存されません。Apple ID がデバイスをリンクするので、手動でのトークン交換は不要です。",
  sec3Title: "Vigili が止まったら、Claude も止まる",
  sec3Body:
    "Vigili に問題が起きた場合、Claude はその場で止まって待ちます。あなたが見ていないときに勝手に許可することは絶対にありません。すべてのウィンドウは復帰までブロックされたままです。",

  footerEyebrow: "近日公開",
  footerTitle: "全 Claude セッションを、1 つのリストで。",
  footerPrivacy: "プライバシー",
};

export function getCopy(lang: Lang): Copy {
  return lang === "ja" ? ja : en;
}
