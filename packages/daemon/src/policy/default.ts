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
  /** ウィザード UI に出す補足説明。 */
  description: string;
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
    rule: {
      name: "git push（--force 以外）",
      when: {
        tool: "Bash",
        command_matches: "^git\\s+push(?!.*(\\s-f|--force)).*$",
      },
      action: "allow",
    },
  },
  {
    id: "webfetch-trusted",
    category: "convenience",
    label: "信頼ドメインへの WebFetch",
    description: "github.com, docs.anthropic.com 等の公式ドキュメント",
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

  // ─── 危険系: ask + critical 通知 (チェックすると critical 通知ルールが作られる) ──
  {
    id: "danger-env-secrets",
    category: "danger",
    label: ".env / 秘密鍵への書き込みを critical 通知",
    description: ".env、secrets/、.pem、.key への書き込みを大音量で通知",
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
  timeout_seconds: 300  # 5 分応答なければ deny

rules: []
`;

/**
 * 旧版互換: 全ルール込みのデフォルト YAML。
 * 既存ユーザーの policy.yaml はこの内容で書き出されている。新規ユーザーは
 * MINIMAL_POLICY_YAML を使うので、こちらは触る必要なし。
 */
export const DEFAULT_POLICY_YAML = MINIMAL_POLICY_YAML;
