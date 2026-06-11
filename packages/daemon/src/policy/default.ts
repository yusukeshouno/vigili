/**
 * Vigili の policy 関連デフォルト・カタログ。
 *
 * 構造:
 * - MINIMAL_POLICY_YAML: 何もルールが入っていない素の policy.yaml。
 *   新規インストール時にこれを書き出し、Mac アプリのオンボーディングで
 *   ユーザーが選んだルールだけが追加される。
 * - POLICY_CATALOG: オンボーディングウィザードで表示する候補ルールの一覧。
 *   各エントリは category / label / description / rule を持つ。
 * - compilePolicyYaml(selectedIds): カタログから選択されたルールを書き出す。
 *
 * 哲学:
 *  CLAUDE.md「ポリシーは対話的に育つ」に従い、最初は空、ユーザーが選んで増やす。
 *  危険操作は defaults.unknown = ask で守られる (明示ルールがなくても ask に落ちる)。
 */

import type { PolicyRule } from "@vigili/shared";

export type PolicyCategory = "convenience" | "danger";

export interface PolicyCatalogEntry {
  /** 永続的な識別子。UI と policy.yaml の両方で参照される。 */
  id: string;
  category: PolicyCategory;
  /** ウィザード UI に出すラベル (短く)。 */
  label: string;
  /** ウィザード UI に出す補足説明 (1 行)。 */
  description: string;
  /**
   * ウィザードの質問画面に出す詳細説明。
   * 「何が許可されるか (具体例)」「何が対象外か」「判定の限界」を正直に書く。
   */
  detail: string;
  /**
   * 自動許可に実リスクが伴うエントリの注意文。
   * これが設定されている場合、ウィザードは「リスクを理解した」の明示チェック
   * なしに「はい (自動で許可)」を押せないようにする。
   */
  caution?: string;
  /** 実際の PolicyRule。name はラベルと同じにする (同名昇格防止のため一意)。 */
  rule: PolicyRule;
}

/**
 * 候補ルールカタログ。
 * convenience = 自動承認 (allow ルール)
 * danger     = 自動承認するな (ask + critical 通知ルール) — 通常は選ばない
 */
export const POLICY_CATALOG: PolicyCatalogEntry[] = [
  // ─── 便利系: auto-allow ─────────────────────────────────────
  {
    id: "read-tool",
    category: "convenience",
    label: "Read ツール (ファイル閲覧)",
    description: "Claude Code の Read ツールによるファイル読み取りをすべて自動承認",
    detail:
      "Claude Code 組み込みの Read ツール (ソースコードや設定ファイルを開く操作) を自動承認します。" +
      "コードを読んで理解する作業の大半がこれに当たるため、確認を挟むと会話が頻繁に止まります。\n\n" +
      "対象外: Bash 経由の cat などは別項目「ファイル読み取り (Bash)」で扱います。\n" +
      "注意: .env など秘密情報ファイルの閲覧も対象に含まれます (書き込みは含まれません)。",
    rule: {
      name: "Read ツール (ファイル読み取り)",
      when: {
        tool: "Read",
      },
      action: "allow",
    },
  },
  {
    id: "read-only-bash",
    category: "convenience",
    label: "ファイル読み取り (Bash)",
    description: "ls, cat, grep, find 等の読み取り専用コマンド",
    detail:
      "ls / cat / head / tail / grep / rg / find / tree / wc / ps / which / pwd / date / echo / " +
      "diff / jq など、読み取り中心のコマンドで始まる Bash を自動承認します。\n\n" +
      "判定の限界: コマンドの先頭だけで判定するため、`cat a.txt > b.txt` のような" +
      "リダイレクト書き込みや `;` で繋いだ後続コマンドも通ります。" +
      "sed -i のようなインプレース編集も先頭が sed なら通ります。" +
      "厳密に守りたい場合はこの項目を「いいえ」にしてください。",
    rule: {
      name: "ファイル読み取り (Bash)",
      when: {
        tool: "Bash",
        command_matches:
          "^(ls|cat|head|tail|rg|grep|fd|find|tree|wc|du|df|ps|top|which|whoami|pwd|date|echo|env|history|stat|file|sort|uniq|cut|awk|sed|tr|jq|yq|column|diff|less|more)\\b",
      },
      action: "allow",
    },
  },
  {
    id: "git-read",
    category: "convenience",
    label: "git の読み取り系",
    description: "git status, diff, log, branch 等",
    detail:
      "git status / diff / log / branch / show / blame / reflog / fetch / pull など、" +
      "リポジトリの状態を見るだけの git コマンドを自動承認します。\n\n" +
      "fetch / pull はリモートから取得するためファイルが変わりますが、" +
      "コミット済みの履歴に沿った変更のみでロールバック可能です。\n" +
      "対象外: commit / push / merge / rebase などの書き込み系は別項目です。",
    rule: {
      name: "git の読み取り系",
      when: {
        tool: "Bash",
        command_matches:
          "^git\\s+(status|diff|log|branch|show|blame|reflog|stash list|remote -v|ls-files|rev-parse|describe|check-ignore|fetch|pull)\\b",
      },
      action: "allow",
    },
  },
  {
    id: "package-install",
    category: "convenience",
    label: "パッケージインストール",
    description: "npm install, pnpm install, yarn install 等",
    detail:
      "pnpm/npm/yarn の install・add・update・remove、bun add、cargo add、" +
      "pip install、uv add などのパッケージ操作を自動承認します。\n\n" +
      "依存関係の追加・更新は開発中に頻発するため、自動化の効果は大きい項目です。",
    caution:
      "パッケージのインストールは postinstall スクリプト経由で任意コードが実行されます " +
      "(サプライチェーン攻撃の入り口)。Claude が提案した未知のパッケージも" +
      "確認なしで入る点を理解した上で有効にしてください。",
    rule: {
      name: "パッケージインストール",
      when: {
        tool: "Bash",
        command_matches:
          "^(pnpm|npm|yarn)\\s+(install|i|add|update|remove|uninstall)\\b|^bun\\s+(install|add|remove)\\b|^cargo\\s+add\\b|^pip\\s+install\\b|^uv\\s+(add|sync|pip)\\b",
      },
      action: "allow",
    },
  },
  {
    id: "tests",
    category: "convenience",
    label: "テスト実行",
    description: "npm test, vitest, jest, pytest, cargo test 等",
    detail:
      "pnpm/npm/yarn test、vitest / jest / playwright、go test / cargo test / pytest " +
      "などのテスト実行を自動承認します。\n\n" +
      "テストは「書く → 走らせる → 直す」のループで何十回も実行されるため、" +
      "確認を挟むと最も律速になりやすい操作です。テストコード自体が任意コードである点は" +
      "意識してください (悪意あるテストは何でもできます)。",
    rule: {
      name: "テスト実行",
      when: {
        tool: "Bash",
        command_matches:
          "^(pnpm|npm|yarn)\\s+(test|vitest|jest|run\\s+test)\\b|^npx\\s+(vitest|jest|playwright)\\b|^(go|cargo)\\s+test\\b|^pytest\\b",
      },
      action: "allow",
    },
  },
  {
    id: "typecheck-lint-build",
    category: "convenience",
    label: "型チェック・lint・build",
    description: "tsc, biome, eslint, prettier, cargo check 等",
    detail:
      "tsc (型チェック)、biome / eslint / prettier (lint・整形)、" +
      "pnpm build / cargo check / cargo build などのビルド系コマンドを自動承認します。\n\n" +
      "コード品質の検証ループで頻発する操作です。lint の --fix や prettier は" +
      "ソースファイルを書き換えますが、対象はリポジトリ内に限られます。",
    rule: {
      name: "型チェック・lint・build",
      when: {
        tool: "Bash",
        command_matches:
          "^(pnpm|npm|yarn)\\s+(typecheck|tsc|lint|format|biome|build|run\\s+(typecheck|build|lint|format))\\b|^npx\\s+(tsc|biome|eslint|prettier)\\b|^cargo\\s+(check|build|clippy|fmt)\\b|^(gofmt|golangci-lint)\\b",
      },
      action: "allow",
    },
  },
  {
    id: "dev-server",
    category: "convenience",
    label: "dev サーバ起動",
    description: "npm dev, vite, uvicorn 等",
    detail:
      "pnpm dev / npm start、next dev、vite、uvicorn、rails server などの" +
      "開発サーバ起動を自動承認します。\n\n" +
      "ローカルでポートを開く操作です。基本的に LAN 内からしかアクセスされませんが、" +
      "0.0.0.0 で bind する設定だと同一ネットワークの他端末からも見える点は把握しておいてください。",
    rule: {
      name: "dev サーバ起動",
      when: {
        tool: "Bash",
        command_matches:
          "^(pnpm|npm|yarn)\\s+(dev|start)\\b|^next\\s+dev\\b|^vite\\b|^uvicorn\\b|^rails\\s+server\\b",
      },
      action: "allow",
    },
  },
  {
    id: "git-commit-branch",
    category: "convenience",
    label: "git の commit / branch 操作",
    description: "git add, commit, checkout, merge, rebase 等",
    detail:
      "git add / commit / checkout / switch / merge / rebase / stash / tag / " +
      "cherry-pick / restore などのローカル git 操作を自動承認します。\n\n" +
      "リモートには影響しません (push は別項目)。コミット履歴に残る操作が中心なので" +
      "ほとんどは reflog から復元可能です。",
    caution:
      "このルールには git reset / git rm / git restore / git checkout -- も含まれます。" +
      "未コミットの作業中変更はこれらで失われると復元できません。" +
      "「コミット前の変更が消えるリスク」を許容できる場合のみ有効にしてください。",
    rule: {
      name: "git の commit / branch 操作",
      when: {
        tool: "Bash",
        command_matches:
          "^git\\s+(add|commit|checkout|switch|merge|rebase|stash|tag|cherry-pick|reset(\\s+--soft|\\s+HEAD)?|mv|rm|restore)\\b",
      },
      action: "allow",
    },
  },
  {
    id: "git-push-safe",
    category: "convenience",
    label: "git push（--force 以外）",
    description: "通常の git push。--force 系は別途常に確認",
    detail:
      "force 系 (-f / --force / --force-with-lease / +refspec 形式) を含まない" +
      "通常の git push を自動承認します。\n\n" +
      "force push は対象外で、main/master への force push はルールに関係なく" +
      "ハードコードされた不変条件が常に拒否します。",
    caution:
      "push はリモートに公開される操作です。CI/CD が main への push で本番デプロイされる" +
      "構成の場合、自動 push がそのまま本番反映になります。" +
      "デプロイ連動があるリポジトリでは有効化を推奨しません。",
    rule: {
      name: "git push（--force 以外）",
      when: {
        tool: "Bash",
        // -f / --force(-with-lease) に加え、`+refspec` (git push origin +main) も
        // force push なので除外する。invariant "force push to protected branch" と
        // 競合しないことが起動時検証の条件 (これを緩めると daemon が起動しなくなる)。
        command_matches: "^git\\s+push(?!.*(\\s-f\\b|\\s--force(-with-lease)?\\b|\\s\\+\\S)).*$",
      },
      action: "allow",
    },
  },
  {
    id: "webfetch-trusted",
    category: "convenience",
    label: "信頼ドメインへの WebFetch",
    description: "github.com, docs.anthropic.com 等の公式ドキュメント",
    detail:
      "github.com、docs.anthropic.com、developer.mozilla.org、nodejs.org、" +
      "developer.apple.com など、定番の公式ドキュメントサイトへの WebFetch を自動承認します。\n\n" +
      "対象はこのドメインリストに完全一致する URL のみで、それ以外のサイトへの" +
      "アクセスは引き続き確認に回ります。github.com 上のコンテンツは誰でも公開できる点" +
      "(悪意ある README 等) は留意してください。",
    rule: {
      name: "信頼ドメインへの WebFetch",
      when: {
        tool: "WebFetch",
        url_matches:
          "^https?://(github\\.com|raw\\.githubusercontent\\.com|docs\\.anthropic\\.com|developer\\.mozilla\\.org|nodejs\\.org|reactjs\\.org|nextjs\\.org|tailwindcss\\.com|vuejs\\.org|sveltejs\\.dev|developer\\.apple\\.com)/",
      },
      action: "allow",
    },
  },

  {
    id: "node-scripts",
    category: "convenience",
    label: "Node.js スクリプト実行",
    description: "node -e, node script.js 等の直接実行",
    detail:
      "node コマンドによるスクリプト直接実行を自動承認します。\n\n" +
      "pnpm/npm 経由のビルドや dev サーバとは別に、node -e や node cli.js など" +
      "バイナリを直接呼ぶケースをカバーします。インターネットへの接続やファイル書き込みを" +
      "伴う場合がありますが、他のルール (curl の外部 API、.env 書き込み等) で" +
      "危険操作は引き続き捕捉されます。",
    rule: {
      name: "Node.js スクリプト実行",
      when: { tool: "Bash", command_matches: "^node\\b" },
      action: "allow",
    },
  },
  {
    id: "file-ops",
    category: "convenience",
    label: "ファイル・ディレクトリ操作 (非破壊)",
    description: "mkdir, cp, mv, ln, touch, chmod 等 (sudo なし・rm は対象外)",
    detail:
      "mkdir / cp / mv / ln / touch / chmod など日常的なファイル操作を自動承認します。\n\n" +
      "rm は誤削除のリスクとフラグ表記の多様さ (-rf / -fr / --recursive 等) を" +
      "正規表現で安全に絞りきれないため対象外とし、引き続き確認に回します。" +
      "sudo なしのユーザー空間操作のみが対象です。",
    rule: {
      name: "ファイル・ディレクトリ操作 (非破壊)",
      when: {
        tool: "Bash",
        command_matches: "^(mkdir|ln|cp|mv|chmod|touch)\\b",
      },
      action: "allow",
    },
  },
  {
    id: "macos-dev-tools",
    category: "convenience",
    label: "macOS / Xcode 開発ツール",
    description: "xcodegen, xcodebuild, xcrun, codesign, open, launchctl 等",
    detail:
      "macOS ネイティブ開発で頻繁に使うツール群を自動承認します。\n\n" +
      "xcodegen / xcodebuild / xcrun / swift / codesign / stapler (公証)、" +
      "open (ファイル・アプリ起動)、launchctl (LaunchAgent 管理)、defaults (plist 操作)、" +
      "osascript (AppleScript) などが対象です。\n\n" +
      "launchctl や osascript はシステム設定を変更できる操作を含むため、" +
      "Mac ネイティブ開発を行わない場合は有効化不要です。",
    rule: {
      name: "macOS / Xcode 開発ツール",
      when: {
        tool: "Bash",
        command_matches:
          "^(xcodegen|xcodebuild|xcrun|swift|swiftc|codesign|stapler|spctl|open|launchctl|defaults|osascript|pbcopy|pbpaste)\\b",
      },
      action: "allow",
    },
  },

  // ─── 危険系: ask + critical 通知 (チェックすると critical 通知ルールが作られる) ──
  {
    id: "danger-env-secrets",
    category: "danger",
    label: ".env / 秘密鍵への書き込みを critical 通知",
    description: ".env、secrets/、.pem、.key への書き込みを大音量で通知",
    detail:
      "これは自動許可ではなく防御ルールです。.env / .env.*、secrets/ ディレクトリ、" +
      ".pem / .key ファイルへの Edit・Write を必ず確認に回し、" +
      "critical 通知 (消音中でも鳴るレベル) でスマホを起こします。\n\n" +
      "秘密情報の書き換えは事故時の影響が大きいため、有効化を推奨します。",
    rule: {
      name: ".env / 秘密鍵への書き込み",
      when: {
        tool: ["Edit", "Write"],
        path_matches: "(^|/)\\.env(\\..+)?$|(^|/)secrets?/|\\.pem$|\\.key$",
      },
      action: "ask",
      notify: "critical",
    },
  },
  {
    id: "danger-external-api",
    category: "danger",
    label: "課金されうる外部 API を critical 通知",
    description: "OpenAI / Anthropic / Stripe への curl を大音量で通知",
    detail:
      "これは自動許可ではなく防御ルールです。api.openai.com / api.anthropic.com / " +
      "api.stripe.com への curl を必ず確認に回し、critical 通知でスマホを起こします。\n\n" +
      "API 課金やテスト決済の誤実行はお金が直接動くため、有効化を推奨します。",
    rule: {
      name: "課金されうる外部 API への curl",
      when: {
        tool: "Bash",
        command_matches: "curl.*(api\\.openai\\.com|api\\.anthropic\\.com|api\\.stripe\\.com)",
      },
      action: "ask",
      notify: "critical",
    },
  },
  {
    id: "danger-prod-db",
    category: "danger",
    label: "本番 DB 接続を critical 通知",
    description: "psql / mysql / mongo / redis-cli の prod 系を大音量で通知",
    detail:
      "これは自動許可ではなく防御ルールです。psql / pg_dump / mysql / mongo / redis-cli の" +
      "コマンドラインに prod / production / live が含まれる場合に必ず確認に回し、" +
      "critical 通知でスマホを起こします。\n\n" +
      "本番データの破壊は取り返しがつかないため、有効化を推奨します。",
    rule: {
      name: "本番 DB へ繋がりそうなコマンド",
      when: {
        tool: "Bash",
        command_matches: "(psql|pg_dump|mysql|mongo|redis-cli).*(prod|production|live)",
      },
      action: "ask",
      notify: "critical",
    },
  },
  {
    id: "danger-force-push",
    category: "danger",
    label: "git push --force を critical 通知",
    description: "force push 系を大音量で通知 (main/master への push は invariants で拒否)",
    detail:
      "これは自動許可ではなく防御ルールです。git push の -f / --force / " +
      "--force-with-lease を必ず確認に回し、critical 通知でスマホを起こします。\n\n" +
      "main / master / production への force push は、このルールの有無に関係なく" +
      "ハードコードされた不変条件が常に拒否します。こちらはそれ以外のブランチ向けの防御です。",
    rule: {
      name: "git push --force / -f / --force-with-lease",
      when: {
        tool: "Bash",
        command_matches: "^git\\s+push\\b.*(\\s-f\\b|\\s--force(?:-with-lease)?\\b)",
      },
      action: "ask",
      notify: "critical",
    },
  },
  {
    id: "danger-sudo",
    category: "danger",
    label: "システム全体への sudo を critical 通知",
    description: "sudo rm / chmod / chown / mv / cp を大音量で通知",
    detail:
      "これは自動許可ではなく防御ルールです。sudo 付きの rm / chmod / chown / mv / cp " +
      "(システム領域を書き換えうる操作) を必ず確認に回し、critical 通知でスマホを起こします。\n\n" +
      "OS 全体に影響する操作のため、有効化を推奨します。",
    rule: {
      name: "システム全体への sudo",
      when: {
        tool: "Bash",
        command_matches: "^sudo\\s+(rm|chmod|chown|mv|cp)\\b",
      },
      action: "ask",
      notify: "critical",
    },
  },
];

/**
 * 何もルールがない素の policy.yaml。
 * defaults.unknown = ask なので、ルール未ヒット時は必ず人間に問い合わせる (安全側)。
 */
export const MINIMAL_POLICY_YAML = `# Vigili Policy
#
# このファイルは Vigili daemon が初回起動時に書き出した素のテンプレートです。
# Mac アプリの設定ウィザードでルールを追加してください。
# 直接編集も可能。編集後は \`vigili-cli reload\` で反映できます。
#
# 評価順序:
#   1. ハードコードされた invariants (rm -rf / 等) が最優先で発火
#   2. 下の rules を上から評価、最初にマッチしたものを採用
#   3. どれにもマッチしなければ defaults.unknown
#
# 詳しくは https://vigili.io/docs/policy を参照。

defaults:
  unknown: ask          # ルール未ヒット時は人間に問う
  timeout_seconds: 120  # 2 分応答なければネイティブ確認にフォールバック

rules: []
`;

/**
 * 旧版互換: 全ルール込みのデフォルト YAML。
 * 既存ユーザーの policy.yaml はこの内容で書き出されている。新規ユーザーは
 * MINIMAL_POLICY_YAML を使うので、こちらは触る必要なし。
 */
export const DEFAULT_POLICY_YAML = MINIMAL_POLICY_YAML;
