/**
 * 初回起動時に書き出される ~/.vigili/policy.yaml のデフォルト内容。
 *
 * このファイルは「Vigili を初めてインストールした人」が触ることを前提に書く。
 * - プロジェクト固有の名前 (repo_in) は出さない。
 * - コメントで「なぜそうしているか」を説明する。
 * - 危険度の高い操作は ask、明らかに安全な日常作業だけ allow。
 * - 迷ったら ask に落ちる (defaults.unknown = ask)。
 *
 * このファイルを更新したら repo 直下の policy.example.yaml も合わせて
 * 更新する (こちらは GitHub で読まれるドキュメント、daemon は default.ts
 * を真とする)。
 */

export const DEFAULT_POLICY_YAML = `# Vigili Policy
#
# このファイルは Vigili daemon が初回起動時に書き出したテンプレートです。
# 編集後は \`vigili-cli reload\` で反映できます。
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

rules:
  # ============================================================
  # 危険操作 — 必ず人間に問う (critical 通知でスマホを起こす)
  # ============================================================

  - name: ".env / 秘密鍵への書き込み"
    when:
      tool: [Edit, Write]
      path_matches: '(^|/)\\.env(\\..+)?$|(^|/)secrets?/|\\.pem$|\\.key$'
    action: ask
    notify: critical

  - name: "課金されうる外部 API への curl"
    when:
      tool: Bash
      command_matches: 'curl.*(api\\.openai\\.com|api\\.anthropic\\.com|api\\.stripe\\.com)'
    action: ask
    notify: critical

  - name: "本番 DB へ繋がりそうなコマンド"
    when:
      tool: Bash
      command_matches: '(psql|pg_dump|mysql|mongo|redis-cli).*(prod|production|live)'
    action: ask
    notify: critical

  - name: "git push --force / -f / --force-with-lease"
    when:
      tool: Bash
      command_matches: '^git\\s+push\\b.*(\\s-f\\b|\\s--force(?:-with-lease)?\\b)'
    action: ask
    notify: critical

  - name: "システム全体への sudo"
    when:
      tool: Bash
      command_matches: '^sudo\\s+(rm|chmod|chown|mv|cp)\\b'
    action: ask
    notify: critical

  # ============================================================
  # 自動許可 — 読み取り系 (危険度ほぼ 0)
  # ============================================================

  - name: "読み取り専用 bash"
    when:
      tool: Bash
      command_matches: '^(ls|cat|head|tail|rg|grep|fd|find|tree|wc|du|df|ps|top|which|whoami|pwd|date|echo|env|history|stat|file|sort|uniq|cut|awk|sed|tr|jq|yq|column|diff|less|more)\\b'
    action: allow

  - name: "git の読み取り系"
    when:
      tool: Bash
      command_matches: '^git\\s+(status|diff|log|branch|show|blame|reflog|stash list|remote -v|ls-files|rev-parse|describe|check-ignore|fetch|pull)\\b'
    action: allow

  - name: "信頼ドメインへの WebFetch (公式ドキュメント類)"
    when:
      tool: WebFetch
      url_matches: '^https?://(github\\.com|raw\\.githubusercontent\\.com|docs\\.anthropic\\.com|developer\\.mozilla\\.org|nodejs\\.org|reactjs\\.org|nextjs\\.org|tailwindcss\\.com|vuejs\\.org|sveltejs\\.dev|developer\\.apple\\.com)/'
    action: allow

  # ============================================================
  # 自動許可 — 開発 workflow (build / test / lint)
  # ============================================================

  - name: "テスト実行"
    when:
      tool: Bash
      command_matches: '^(pnpm|npm|yarn)\\s+(test|vitest|jest|run\\s+test)\\b|^npx\\s+(vitest|jest|playwright)\\b|^(go|cargo)\\s+test\\b|^pytest\\b'
    action: allow

  - name: "型チェック・lint・format・build"
    when:
      tool: Bash
      command_matches: '^(pnpm|npm|yarn)\\s+(typecheck|tsc|lint|format|biome|build|run\\s+(typecheck|build|lint|format))\\b|^npx\\s+(tsc|biome|eslint|prettier)\\b|^cargo\\s+(check|build|clippy|fmt)\\b|^(go|gofmt|golangci-lint)\\b'
    action: allow

  - name: "dev サーバ起動"
    when:
      tool: Bash
      command_matches: '^(pnpm|npm|yarn)\\s+(dev|start)\\b|^next\\s+dev\\b|^vite\\b|^uvicorn\\b|^rails\\s+server\\b'
    action: allow

  - name: "git の commit / branch 操作 (push は別ルール)"
    when:
      tool: Bash
      command_matches: '^git\\s+(add|commit|checkout|switch|merge|rebase|stash|tag|cherry-pick|reset(\\s+--soft|\\s+HEAD)?|mv|rm|restore)\\b'
    action: allow

  - name: "git push (--force 系は上のルールで弾く)"
    when:
      tool: Bash
      command_matches: '^git\\s+push(?!.*(\\s-f|--force)).*$'
    action: allow

  # ============================================================
  # 時間帯ルール (好みで外す)
  # ============================================================

  # 深夜帯の外部 WebFetch は朝までレビュー保留にしたい人向け。
  # 不要なら丸ごとコメントアウトしてください。
  # - name: "深夜の外部通信は翌朝レビュー"
  #   when:
  #     tool: WebFetch
  #     time_between: ["02:00", "07:00"]
  #   action: deny
  #   reason: "深夜帯は外部通信を停止しています"

  # ============================================================
  # その他 — 人間に問う
  # ============================================================

  - name: "未分類の Bash"
    when:
      tool: Bash
    action: ask
    notify: normal

  - name: "未分類の Edit / Write"
    when:
      tool: [Edit, Write]
    action: ask
    notify: normal
`;
