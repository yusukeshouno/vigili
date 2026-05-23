# Sentinel — Project Constitution for Claude Code

このファイルは Claude Code がこのプロジェクトで作業するときに最初に読むべき規約です。`SPEC.md` の前にここを読んでください。

## プロダクト一行説明

Claude Code の承認プロンプトを、ローカルデーモンが奪取してポリシー判定し、必要なときだけ手元のスマホに飛ばすシステム。承認のためだけのプロダクト。

## 何を解こうとしているか

開発者（一人）が複数の Claude Code セッション（Neort Wiki / Diptych / Pluris / Passage など 4〜6 並列）を同時に走らせると、各セッションの承認プロンプトを画面の前で見張る必要が出る。これが律速になる。承認を「分類問題」として定義し直し、自動許可・自動拒否・人間に問うの 3 値に振り分け、人間に問う場合の応答経路を最短化する（ターミナルに戻らずスマホで二タップ）。

## 設計原則（迷ったらここに戻る）

1. **承認は分類である**。すべての承認待ちは `allow / deny / ask` のいずれかに振り分けられる。律速はこの分類速度。
2. **人間への問い合わせは最短経路で**。ターミナルに戻る必要をなくす。スマホで二タップ。
3. **複数セッションは単一キューに正規化**。プロジェクト別に色分けはするが、見る場所は一つ。
4. **危険な操作は必ず人間に問う**。`rm -rf`、`.env` 書き換え、外部 API 課金、`git push --force`、本番 DB 操作はポリシー側で強制的に `ask` または `deny`。ユーザーが `allow` ルールを書こうとしても警告を出す。
5. **ポリシーは対話的に育つ**。人間が「Allow & promote to rule」を押すたびにルールが増える。最初から完璧なルールを書こうとしない。
6. **観測可能性を最優先**。デーモンは全ての判定をログに残す。1 日の終わりに「自動許可した N 件」を振り返れること。

## 非目標（これはやらない）

- マルチユーザー対応。設計は一人開発者向け。チーム共有は後日別プロダクトとして考える。
- クラウドホスティング。デーモンはローカル常駐。外部公開は Tailscale Funnel のみ。
- Claude Code 以外のエージェント対応。OpenAI Codex などへの拡張は MVP 後。
- ネイティブモバイルアプリ。PWA で十分。
- GUI でのポリシー編集。YAML 直書きで十分。PWA からはルール昇格のみ。

## 技術スタックの確定事項

| 層 | 技術 | 理由 |
|---|---|---|
| L1 Gate | Node.js (TypeScript)、単一バイナリ化は pkg または bun build | Claude Code の hook から起動されるので軽量起動が必須 |
| L2 Daemon | Node.js (TypeScript)、Fastify + ws、SQLite (better-sqlite3) | 既存スタック踏襲、ファイル一個で永続化 |
| L3 PWA | Next.js 15 (App Router) + Tailwind v4 | NEORT 既存案件の流儀と揃える |
| 通信 | ローカル: Unix domain socket、外部: WebSocket over Tailscale | TCP ポートを開けない |
| 通知 | ntfy.sh（自前 VPS 不要）+ PWA Service Worker | Pushover は後回し |

## コーディング規約

- TypeScript strict mode。`any` は禁止。やむを得ない場合は `// eslint-disable-next-line` でコメント必須。
- ESM のみ。CommonJS は書かない。
- パッケージマネージャは `pnpm`。`workspaces` を使ったモノレポ。
- フォーマッタは Biome。`pnpm format` で整形。
- テストは `vitest`。ポリシーエンジンと gate の判定ロジックは必ずテスト。PWA はテストなしで可。
- コミットメッセージは Conventional Commits。`feat:` `fix:` `chore:` `docs:` の 4 種類で足りる。
- ブランチ戦略は trunk-based。`main` に直接マージ。

## ディレクトリ規約

```
sentinel/
├── packages/
│   ├── gate/          # L1: フックから呼ばれる CLI（短命プロセス）
│   ├── daemon/        # L2: 常駐プロセス、ポリシー判定、キュー管理
│   ├── shared/        # L1/L2/L3 共通の型定義（zod スキーマ）
│   └── pwa/           # L3: Next.js 15 PWA
├── policy.example.yaml
├── CLAUDE.md          # ← このファイル
├── SPEC.md            # 機能仕様
├── IMPLEMENTATION_PLAN.md
└── README.md          # ユーザー向け運用手順
```

`shared/` には zod スキーマだけを置く。ランタイムロジックは置かない。L1/L2/L3 がすべてこの型を import する。

## セキュリティ規約（絶対遵守）

- デーモンは Unix domain socket を `~/.sentinel/daemon.sock` に作る。パーミッションは 0600。TCP ポートを開かない。
- 外部公開は Tailscale Funnel 経由の WebSocket のみ。HTTPS は Tailscale が終端する。
- PWA からデーモンへの認証は、デーモン起動時に生成される token（`~/.sentinel/token`）を PWA に登録する方式。Bearer トークンで毎リクエスト送る。
- ポリシーファイルのパースエラーで起動失敗したら、フェイルセーフは **deny**。ask ではない。デーモンが死んでいるときに自動許可してはいけない。
- gate がデーモンに接続できなかった場合のフェイルセーフも **deny**。これは PreToolUse hook で exit 2 を返すことで Claude Code 側にブロックさせる。

## ポリシー設計の不変条件

これらは YAML ルールで書き換えられない、ハードコードされた制約：

- `rm -rf /` 系のパターンは無条件 `deny`
- `git push --force` を main/master/production ブランチに向けるパターンは無条件 `deny`
- ユーザーが書いたルールで上記を `allow` にしようとしても、daemon 起動時の policy validate で reject する

これは `packages/daemon/src/policy/invariants.ts` に集約する。

## Claude Code が作業するときの指針

- 新しい機能を追加する前に、`SPEC.md` の該当セクションを更新してから実装する。仕様と実装が乖離していたら仕様を真とする。
- L1 Gate を変更したら、ポリシーエンジンのテストを必ず走らせる（`pnpm --filter daemon test`）。
- PWA は最後でいい。L1 と L2 が動いてから着手する。MVP では curl で承認できれば十分。
- パッケージ追加するときは、なぜそれが必要か `CHANGELOG.md` に一行残す。`lodash` のような汎用ライブラリは原則入れない。標準で書ける。
- `--remote` フラグで動かすことは想定しない。Sentinel 自体はローカル PC でしか動かない。

## よくある誤解の回避

- これは「Claude Code を安全にする」プロダクトではない。Claude Code は十分安全。これは「承認画面を見張る人間時間を回収する」プロダクト。
- 自動許可ルールを増やせば増やすほど律速は減るが、危険も増える。trade-off の自覚を UI に反映する（1 日のサマリーで自動許可件数を見せる、など）。
- 「人間が承認した = 安全」ではない。疲れている人間は安全な判断をしない。だからこそポリシーで自動化したい。
