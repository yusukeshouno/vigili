# Vigili — Functional Specification

このドキュメントは Vigili の機能仕様を定義します。実装と仕様が乖離した場合、こちらを真とします。

---

## 1. システム全体

### 1.1 構成

```
┌─────────────────────────────────────────────────────────────┐
│ Local Machine (Mac mini / Mac Studio)                        │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Claude Code  │  │ Claude Code  │  │ Claude Code  │ ...  │
│  │ (Neort Wiki) │  │ (Diptych)    │  │ (Pluris)     │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │ PreToolUse hook                                    │
│         └─────────┬────────┴──────────────┘                  │
│                   ▼                                          │
│         ┌──────────────────┐                                 │
│         │  sentinel-gate   │  (短命 CLI)                      │
│         │  (L1 Interceptor)│                                 │
│         └─────────┬────────┘                                 │
│                   │ Unix domain socket                       │
│                   ▼                                          │
│         ┌──────────────────┐                                 │
│         │ sentinel-daemon  │  (常駐)                          │
│         │ ┌──────────────┐ │                                 │
│         │ │ Policy Engine│ │  ← policy.yaml                  │
│         │ ├──────────────┤ │                                 │
│         │ │ Queue (SQLite│ │                                 │
│         │ ├──────────────┤ │                                 │
│         │ │ WebSocket Hub│ │                                 │
│         │ └──────────────┘ │                                 │
│         └─────────┬────────┘                                 │
└───────────────────┼─────────────────────────────────────────┘
                    │ WebSocket over Tailscale Funnel
                    ▼
              ┌──────────┐
              │ PWA      │  (iPhone / Apple Watch)
              │ (L3)     │
              └──────────┘
                    │
                    ▼
              ntfy.sh  (push 通知)
```

### 1.2 データフロー（承認待ち発生時）

1. Claude Code が `Bash` ツール実行直前に `PreToolUse` hook を起動
2. hook は `sentinel-gate` を起動、stdin に JSON で `{tool_name, tool_input, cwd, session_id}` を渡す
3. gate は `~/.sentinel/daemon.sock` に接続し、上記 JSON を送る
4. daemon は policy engine に通し、`allow / deny / ask` を決定
5. `allow` なら即座に gate に返す → gate は exit 0 → Claude Code は実行続行
6. `deny` なら即座に返す → gate は exit 2 → Claude Code は実行中止
7. `ask` なら daemon は queue に記録し、WebSocket で接続中の PWA にプッシュ＆ntfy で通知
8. PWA が `approve` または `deny` を返すと、daemon は gate に結果を返す（ブロッキング待ち）
9. タイムアウト（デフォルト 5 分）すると daemon は `deny` で返す

---

## 2. L1: sentinel-gate

### 2.1 責務

- `PreToolUse` hook から起動される短命 CLI
- stdin から受け取った JSON を daemon に転送
- daemon の判定結果に応じた exit code を返す
- daemon が死んでいる/応答しない場合は **exit 2 (deny) を返す**

### 2.2 インターフェース

起動コマンド：

```bash
sentinel-gate --session $CLAUDE_SESSION_ID --tag <repo_tag>
```

`--tag` は省略可。省略時は `cwd` のディレクトリ名から推測する。

stdin から受け取る JSON（Claude Code Hooks の仕様に準拠）：

```json
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf node_modules"
  },
  "cwd": "/Users/yusuke/Code/neort-wiki",
  "session_id": "abc123"
}
```

exit code の意味（Claude Code Hooks の仕様に準拠）：

- `0`: allow（実行続行）
- `2`: deny（実行中止）
- その他: Claude Code が標準の確認プロンプトを出す（フォールバック）

### 2.3 接続プロトコル

Unix domain socket `~/.sentinel/daemon.sock` に接続し、改行区切り JSON を 1 行送る。daemon は 1 行返す：

```json
{ "decision": "allow" }
{ "decision": "deny", "reason": "..." }
{ "decision": "ask", "request_id": "..." }
```

`ask` を受け取った場合、gate は同じソケット上で `request_id` の決着を待つ。daemon は決着次第こう返す：

```json
{ "request_id": "...", "decision": "allow" }
```

### 2.4 タイムアウト

- daemon 接続のタイムアウト: 500ms
- `ask` 後の決着待ちタイムアウト: 設定可能（デフォルト 5 分）
- いずれもタイムアウトしたら exit 2

---

## 3. L2: sentinel-daemon

### 3.1 責務

- Unix domain socket をリッスンして gate からの要求を受ける
- policy.yaml をロードしてポリシー判定する
- `ask` 案件を SQLite キューに永続化
- PWA に WebSocket でプッシュ通知
- ntfy.sh に push 通知を送る
- 監査ログを書く

### 3.2 起動と設定

```bash
sentinel-daemon start [--config ~/.sentinel/policy.yaml] [--port 7878]
```

`--port` は WebSocket サーバ用。Unix socket は固定で `~/.sentinel/daemon.sock`。

起動時に以下を行う：

1. policy.yaml をロード＆バリデート（invariants チェック含む）
2. SQLite DB を `~/.sentinel/queue.db` に開く（マイグレーション含む）
3. Unix socket を bind（既存ファイルがあれば削除）
4. WebSocket サーバを起動
5. token を `~/.sentinel/token` から読む（なければ生成）

### 3.3 ポリシーエンジン

policy.yaml の構造：

```yaml
defaults:
  unknown: ask           # ask | allow | deny
  timeout_seconds: 300

rules:
  - name: <human-readable>
    when:
      tool: <Bash|Edit|Write|WebFetch|...>           # 単一または配列
      command_matches: <regex>                        # tool=Bash のとき
      path_matches: <regex>                           # tool=Edit/Write のとき
      url_matches: <regex>                            # tool=WebFetch のとき
      repo_in: [<dir_name>, ...]                      # cwd basename
      time_between: ["HH:MM", "HH:MM"]                # JST
    action: allow | deny | ask
    reason: <string>
    notify: normal | critical                         # action=ask のときのみ
```

評価順序：

1. ハードコードされた invariants を先に評価
2. 上から順にルールを評価、最初にマッチしたものを採用
3. どれにもマッチしなければ `defaults.unknown`

#### 不変条件（ハードコード）

`packages/daemon/src/policy/invariants.ts` に集約：

```typescript
export const INVARIANTS = [
  {
    name: "rm -rf root",
    matches: (req) => req.tool === "Bash" && /\brm\s+-rf\s+\/(\s|$)/.test(req.command ?? ""),
    decision: "deny",
  },
  {
    name: "force push to protected branch",
    matches: (req) => req.tool === "Bash" && /git\s+push.*--force.*\b(main|master|production)\b/.test(req.command ?? ""),
    decision: "deny",
  },
  // ...
];
```

ユーザーポリシーで上書き不可。policy.yaml のロード時、invariants が deny にする条件を allow にしようとしているルールがあったら起動失敗。

### 3.4 キュー

SQLite テーブル：

```sql
CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,                  -- UUID
  created_at INTEGER NOT NULL,          -- unix ms
  resolved_at INTEGER,
  session_id TEXT NOT NULL,
  session_tag TEXT,                     -- 'neort-wiki' など
  tool_name TEXT NOT NULL,
  tool_input TEXT NOT NULL,             -- JSON
  cwd TEXT NOT NULL,
  decision TEXT,                        -- 'allow' | 'deny' | NULL (未決)
  decided_by TEXT,                      -- 'policy:<rule_name>' | 'human:<source>' | 'timeout'
  reason TEXT
);

CREATE INDEX idx_pending ON approval_requests(decision) WHERE decision IS NULL;
CREATE INDEX idx_created ON approval_requests(created_at DESC);
```

監査用に**全件残す**。自動許可されたものもここに入る。

### 3.5 WebSocket プロトコル

エンドポイント: `wss://<tailscale-funnel-hostname>/ws`

認証: 接続時に `?token=<bearer>` クエリパラメータ、または `Authorization` ヘッダ。

サーバ → クライアント：

```json
{ "type": "pending", "request": { ... } }    // 新しい ask
{ "type": "resolved", "id": "...", "decision": "allow" }  // 他経路で決着
{ "type": "snapshot", "pending": [...] }     // 接続直後の現在の保留一覧
```

クライアント → サーバ：

```json
{ "type": "decide", "id": "...", "decision": "allow", "promote": null }
{ "type": "decide", "id": "...", "decision": "allow", "promote": { "rule_name": "...", "match": {...} } }
```

`promote` が指定された場合、daemon は policy.yaml の末尾に新しいルールを追記する（コメント付き）。

### 3.6 ntfy 連携

`~/.sentinel/config.yaml` に：

```yaml
ntfy:
  server: https://ntfy.sh
  topic: sentinel-yusuke-<random>      # 推測されない名前
  priority_map:
    normal: 3
    critical: 5
```

`action: ask` で `notify: critical` のものは priority 5 + tag で送る。

---

## 4. L3: Mobile Approver PWA

### 4.1 責務

- Tailscale Funnel 経由で daemon に WebSocket 接続
- 承認待ちキューを表示
- 承認/拒否を返す
- ルール昇格を送る
- Service Worker で push 通知を OS に出す

### 4.2 画面

#### Queue 画面

- 上から新しい順
- カードに表示する情報:
  - セッションタグ（色付き）
  - ツール名
  - 要約コマンド（長い場合は省略）
  - cwd の basename
  - 経過秒数（リアルタイム更新）
- スワイプ操作:
  - 右スワイプ: allow once
  - 左スワイプ: deny
  - タップ: 詳細画面へ

#### Detail 画面

- フルコマンド or diff or URL
- 影響を受けるファイルパス（Edit/Write の場合）
- ボタン:
  - `Allow once`
  - `Deny`
  - `Allow & promote to rule` → ルール提案モーダル

#### ルール提案モーダル

- マッチ条件の候補を自動生成:
  - `command_matches`: コマンドの先頭トークンから正規表現を提案
  - `repo_in`: 現在の cwd の basename を提案
- ユーザーが編集できる
- 確定すると daemon に `promote` 付きで decide を送る

### 4.3 通知

- Service Worker で push 通知を受ける
- 通知タップで該当 request の詳細画面を開く

### 4.4 認証

- 初回起動時に token 入力画面
- token は IndexedDB に保存
- WebSocket 接続時に `?token=` で送る

---

## 5. 設定ファイル

### 5.1 `~/.sentinel/policy.yaml`

ポリシー本体。`policy.example.yaml` をコピーして編集する。

### 5.2 `~/.sentinel/config.yaml`

daemon の動作設定：

```yaml
daemon:
  socket_path: ~/.sentinel/daemon.sock
  ws_port: 7878
  db_path: ~/.sentinel/queue.db
  log_path: ~/.sentinel/daemon.log

ntfy:
  server: https://ntfy.sh
  topic: <user-defined>

session_tags:
  # cwd basename → tag のマッピング
  neort-wiki: "Neort Wiki"
  diptych: "Diptych"
  pluris: "Pluris"
  passage: "Passage"
```

### 5.3 `~/.sentinel/token`

ランダム生成された PWA 認証トークン。daemon が起動時になければ生成。

---

## 6. CLI コマンド

```
sentinel-daemon start                  # 常駐起動
sentinel-daemon stop                   # 停止
sentinel-daemon status                 # 状態確認
sentinel-daemon logs [--follow]        # ログ閲覧
sentinel-daemon policy validate        # ポリシー検証
sentinel-daemon policy reload          # ホットリロード

sentinel-cli pending                   # 保留中の承認待ち一覧
sentinel-cli approve <id>              # CLI から承認
sentinel-cli deny <id>                 # CLI から拒否
sentinel-cli history [--today]         # 監査ログ閲覧
sentinel-cli stats [--today]           # 統計（自動許可 N 件、人間判定 M 件など）
```

---

## 7. 非機能要件

- gate の起動から daemon 応答までの p95 レイテンシは 50ms 以下（自動許可ルール時）
- daemon の常駐メモリは 100MB 以下
- SQLite DB は 100MB を超えたら自動で 30 日以前のレコードを削除（監査ログは別ファイルにアーカイブ）
- ポリシー reload はゼロダウンタイム（gate の進行中リクエストには旧ポリシーが適用される）
- **同期の自動回復は積極的に**: WS が切れた / half-open になったら短時間で再接続し、「同期が切れたまま放置」を避ける。
  - daemon→relay (`server/relay-client.ts`): 周期 ping 10s で half-open 検知、reconnect backoff 初回 500ms・cap 15s。
  - iOS/Mac クライアント (`DaemonWsClient`): 周期 ping 10s、reconnect backoff cap 8s、前面化 / 通知タップで即再接続。Mac host (`AppCoordinator`) は 1s tick で未接続を検知し 5s ごとに `reconnectNow()`（widget の stale 放置を防ぐ）。
  - PWA (`ws-client.ts`): reconnect backoff cap 5s、`visibilitychange`(タブ復帰) / `online`(ネット復帰) で即再接続。
  - half-open 検知は基本 server 側の周期 ping/timeout に委ね、各 client は close を受けたら即 backoff 再接続する。

---

## 8. L4: ホスト型セッション (`vigili run`) — 対話型リモート応答

### 8.1 動機と前提

L1 gate（`PreToolUse` hook）はツール承認しか奪取できない。実測の結果、Claude Code の **対話型ツール `AskUserQuestion` と `ExitPlanMode` は `PreToolUse` hook を発火せず**、TUI 内部で処理されフック経路を完全にバイパスすることが分かった（daemon 監査ログ 4172 件・21 ツール種に両者が 0 件である一方、生トランスクリプトには AskUserQuestion 168 回 / ExitPlanMode 4 回の実使用が存在）。

したがって「対話型の問い合わせ（選択肢質問・plan 承認・自由文の質問）でセッションが止まる」問題を手元のスマホで解くには、フックの背後に座るのではなく **セッション自体を Vigili がホストする**しかない。これを担うのが新コマンド `vigili run`。

### 8.2 スコープと UX 方針

- **オプトイン併用**: 普段は素の `claude` TUI をそのまま使う。スマホ応答したいセッションだけ `vigili run` で起動する 2 経路構成。`vigili run` で起動したセッションでは素の Claude Code TUI は使えず、Vigili が薄い stdout 表示を出す（端末でもスマホでも応答可能）。
- **会話も全部**: permission 承認・`AskUserQuestion` の選択肢回答・plan 承認に加え、**自由文の返信**もスマホから可能。transcript もスマホへ配信しチャット UI 化する。

### 8.3 アーキテクチャ

```
端末: vigili run [--tag <t>] [prompt]
  └ @anthropic-ai/claude-agent-sdk (セッションを所有・streaming 入力)
        │  unix socket (kind:"session", 双方向・多重 write)
        ▼
   daemon: ★セッションレジストリ(新規) + 既存 queue/fan-out/messageStore
        │  既存 broadcastAll → LAN WS + relay(透過バイトパイプ、改修不要)
        ▼
   iOS/Mac/PWA: transcript 描画 + 回答 UI(選択肢/permission/plan/自由文)
```

Claude Code SDK 側の対応（**P0 スパイクで実測確定**）:
- **permission**: `canUseTool(toolName, input)` → `{behavior:"allow", updatedInput?}` / `{behavior:"deny", message}`。
- **AskUserQuestion**: `canUseTool` に `toolName==="AskUserQuestion"`, `input.questions[]`（各要素 `{question, header, multiSelect, options:[{label, description}]}`）として現れ、`{behavior:"allow", updatedInput:{...input, answers:{<question>:<label>}}}` で回答できる（実測 OK）。
- **plan 承認**: 当初の想定に反し、`ExitPlanMode` も `canUseTool` に `toolName==="ExitPlanMode"`, `input.plan`(full markdown) として現れる。`allow`=承認 / `deny`=却下。plan 起草の `~/.claude/plans/*.md` への Write は内部処理で canUseTool を通らない（実測 OK）。
- **自由文の質問**: streaming 入力（async-generator prompt）で `{type:"user", message:{role:"user", content}}` を yield＝次の user turn を送る＝返信。
- **zod peer 注意**: SDK は `zod@^4` を要求。リポジトリの `@vigili/shared` は zod@3。runtime は警告のみで動作するため、SDK は runner パッケージに隔離し daemon/shared は zod@3 据え置き。

### 8.4 `vigili run` CLI（新パッケージ `packages/runner`）

セッション駆動は **新パッケージ `@vigili/runner`** が担う。理由: ①常駐 daemon を軽量に保つ（SDK は重く、Claude プロセスを spawn する短命〜中命プロセスは常駐 daemon と性質が違う）／②SDK の `zod@4` peer を daemon/shared(zod@3) から物理隔離する／③SPEC §8.6 の「runner↔daemon は socket」をプロセス境界＝パッケージ境界に一致させる。bin は `vigili`：

```
vigili run [--tag <tag>] [--cwd <dir>] [--permission-mode <plan|default|...>] [初期prompt]
```

- daemon が起動していなければ fail-safe（接続不可なら起動を促す）。
- `~/.vigili/{socket,token}` を読み、unix socket に `kind:"session"` で接続。
- transcript を stdout に薄く表示し、ローカル stdin からの入力も受ける（端末フォールバック）。
- runner は短命〜中命（セッション起動時のみ）。Agent SDK 依存はこのパッケージに閉じる。

### 8.5 セッションレジストリ（daemon）

現状 session は `session_id` 文字列タグでしかなく first-class な実体が無い。`vigili run` のために daemon に追加する：

```
HostedSession = {
  session_id: string,        // SDK の session_id を採用
  tag: string | null,
  cwd: string,
  status: "running" | "awaiting" | "ended",
  started_at: int,
}
```

- レジストリは in-memory（再起動で揮発）。transcript は直近 N 行のみ保持（永続化は将来課題）。
- runner との socket は長命・双方向（既存 `socket.ts` の多重 write 対応を利用）。

#### 8.5.1 gate 由来セッションの合成表示（observed session）

`vigili run` を使わない素の Claude Code セッション（PreToolUse hook → gate 経由）も
Sessions 画面に出す。daemon が gate からの `ToolRequest`（`session_id` / `cwd` /
`session_tag` を含む）を観測してセッションを**合成 (synthesize)** する：

- `handleToolRequest` で `session_id` をキーに upsert。初出時に `session-started` を
  broadcast（snapshot には既存経路で自動同梱）。`tag` は `session_tag` → `inferRepoTag(cwd)`
  の順で決める。
- **status**: そのセッションに pending（未決着の ask）が 1 件以上ある間は `awaiting`、
  無ければ `running`。決着 (resolve) のたびに再評価する。
- **終了検出**: gate 経由には切断シグナルが無いので近似する。最終 observe から
  **30 分**（`session_idle_ttl_seconds`、config で変更可）リクエストが無ければ `ended` とし
  `session-ended` を broadcast。既存 sweep タイマー（60s 周期）に同居させる。
- **`vigili run` との区別**: ホスト型（live conn あり）は従来どおり切断＝終了で、TTL の
  対象外。同一 `session_id` でホスト型が register された場合はホスト型が優先（conn 付き
  エントリで上書き）。observed session は `sendToSession` 不可（conn 無し）であり、
  transcript / question / plan は持たない（クライアントは一覧と status 表示のみ）。
- クライアント (iOS/Mac/PWA) は無改修：既存の `session-started` / `session-ended` /
  snapshot `sessions` をそのまま描画する。

### 8.6 プロトコル拡張

#### runner ↔ daemon（unix socket, `kind:"session"`）

- runner→daemon: `session-start` / `transcript-append` / `question` / `permission-request` / `plan` / `session-end`
- daemon→runner: `answer` / `permission-decision` / `reply`(自由文) / `plan-decision`

#### daemon → client（`WsServerMessage` に追加。既存クライアントは未知 type を `default: break` で無害化）

```
"session-started"   { session: HostedSession }
"session-ended"     { session_id, reason? }
"transcript-append" { session_id, line: TranscriptLine }
"question"          { session_id, request_id, questions: Question[] }   // AskUserQuestion
"plan"              { session_id, request_id, plan: string }            // plan 承認
```
permission 承認は既存 `"pending"`/`ApprovalRequest`（allow/deny）を流用し `decided_by`/source で hosted 由来を区別。

#### client → daemon（`WsClientMessage` に追加）

```
"answer-question"   { request_id, answers: Record<string,string> }
"decide-plan"       { request_id, decision: "approve"|"reject", reason? }
"session-reply"     { session_id, body }                                // 自由文返信
```
permission 決定は既存 `"decide"` を流用。自由文は既存 `send-message`/`messageStore` を再利用してもよい。

#### 新規 shared zod 型

```
TranscriptLine = { role: "assistant"|"user"|"tool"|"system", text: string, at: int, tool_name?: string }
Question        = { question: string, header: string, options: {label, description}[], multiSelect: boolean }
```

### 8.7 relay / APNs

relay は payload を透過転送するため**新 variant でも改修不要**。ただしバックグラウンドのスマホを起こす APNs wake は現状 `type:"pending"` のみ。`question` / `plan` / hosted permission でも `maybePushApns` を発火させ、注意喚起イベントで端末を起こす。

### 8.8 段階的実装（フェーズ）

- **P0 スパイク（完了）**: SDK 挙動を実測確定（§8.3）。AskUserQuestion / ExitPlanMode とも `canUseTool` で奪取・回答可能と判明。
- **P0.5 パッケージ整備（完了）**: `@vigili/runner` 新設。SDK 依存を daemon→runner へ移設。bin `vigili`。最小 `vigili run`（transcript を stdout、permission/AskUserQuestion/plan をローカル端末で処理）。
- **P1（完了）**: セッションレジストリ + socket プロトコル（`kind:"session"`）+ WS 新 variant fan-out。
  - shared: `session.ts`（`HostedSession` / `TranscriptLine` / `Question` / `SessionRunnerMessage` / `SessionDaemonMessage`）+ ws.ts に `session-started`/`session-ended`/`transcript-append`/`question`/`plan` server variant と `answer-question`/`decide-plan`/`session-reply` client variant、snapshot に `sessions[]`。
  - daemon: `sessions.ts`（in-memory `SessionRegistry`、request_id↔conn 対応づけ）。`handleLine` が `kind:"session"` を session 経路へ。permission は既存 policy engine + queue を再利用（§8.6: 自動許可/自動拒否/スマホ承認）。WS/relay の snapshot と sweep 再送に稼働セッションを同梱。
  - 検証: `sessions.test.ts`（レジストリ単体 8 件）+ `daemon.test.ts` の hosted-session 統合 5 件（auto-allow/auto-deny/invariant-deny/ask→admin approve/malformed→session-error）。`pnpm --filter @vigili/daemon test` green。
- **P1b（完了）**: runner を daemon socket（`kind:"session"`）へ接続し、ローカル Io/permission を daemon 経由に置換（真の end-to-end）。
  - runner: `paths.ts`（daemon socket パス解決、`$VIGILI_HOME`/`$SENTINEL_HOME` 上書き対応）+ `daemon-conn.ts`（`DaemonConn`：行区切り JSON、`request_id` 単位の pending 解決、socket 断で全 in-flight を fail-safe＝permission deny / plan reject / question null）。
  - runner: `permission.ts` に `makeDaemonCanUseTool(conn)` 追加（AskUserQuestion→`question`、ExitPlanMode→`plan`、その他ツール→`permission-request`。read-only も daemon の policy engine 経由で全可観測化）。`render.ts` に `toTranscriptLines()` 追加（SDK message → `TranscriptLine[]`）。
  - runner: `session.ts` が起動時に `connectDaemon()` を試行。接続できれば daemon-backed セッション（transcript fan-out + リモート回答 + ローカル stdin 併用）、不可なら従来のローカル端末フォールバック。`--local` で daemon を明示スキップ。
  - 検証: `daemon-conn.test.ts`（fake unix server で round-trip 9 件：permission allow/deny+reason・question・plan・reply・接続失敗 null・socket 断 fail-safe・close 後即時 fail-safe）。`pnpm --filter @vigili/runner test` green、typecheck/build/format clean。
- **P2（完了）**: iOS/Mac に transcript 描画 + 回答 UI。
  - shared (Swift): `HostedSession` / `TranscriptLine` / `QuestionOption` / `Question` / `PendingQuestion` / `PendingPlan` モデル（`Models.swift`）。`DaemonWsClient` が `snapshot.sessions` / `session-started` / `session-ended` / `transcript-append` / `question` / `plan` を受信し、`answerQuestion` / `decidePlan` / `sendSessionReply` を送信。`AppCoordinator` / `MobileAppCoordinator` に mirror + 委譲メソッド。チャット吹き出し・質問/plan 回答・返信欄は `Shared/SessionChatViews.swift`（`TranscriptScroll` / `TranscriptBubble` / `QuestionAnswerView` / `PlanAnswerView` / `ReplyComposer`）に集約し Mac/iOS 共用。
  - Mac: `SessionsWindow` + `SessionsView`（独立ウィンドウ）。左にセッション一覧、右に transcript チャット（assistant/user/tool/system 吹き出し・自動スクロール）+ 未回答の質問（AskUserQuestion・選択肢ボタン single/multi）+ plan 承認/却下（ExitPlanMode）+ 自由文返信。popover フッターに 💬 エントリ（未回答ありで赤バッジ）。
  - iOS: `MobileSessionsView`。topBar の 💬（未回答で赤バッジ）→ sheet → NavigationStack（セッション一覧 → タップで詳細：transcript + 回答 + 返信）。共通サブビューを使用。
  - ホスト型セッションの「ツール許可」は既存の承認キュー（Mac popover / iOS カード）にそのまま出るので本 UI では扱わない。
  - multiSelect 質問は protocol が `answers: record(string)`（質問あたり 1 文字列）なので、選択 label を `", "` 連結して 1 文字列で返す簡易対応。
  - 検証: macOS（`-scheme Vigili`）+ iOS（`-scheme VigiliMobile`, generic iOS Simulator）両 CLI ビルド green。
- **P3（完了・要デプロイ）**: relay/APNs wake 拡張。`maybePushApns`（`packages/relay/src/index.ts`）を `pending` だけでなく `question`（質問が届いています + 質問文）/ `plan`（Plan の承認待ち + 先頭行）でも発火。ホスト型 permission はキュー経由で `pending` になるため既存経路でカバー済み。検証: `relay-apns.test.ts` に question/plan の push を 2 件追加（relay 42 tests green、typecheck/format clean）。VPS へデプロイ済み（`deploy.sh` → `systemctl restart vigili-relay` active、`/healthz` ok、Mac daemon 再接続確認）。ただし VPS の APNs は `未設定`（`APNS_KEY_PATH/KEY_ID/TEAM_ID/TOPIC` 欠如）のため、push の実発火は #64 の資格情報投入後に有効化される。
- **P4（完了）**: PWA パリティ。`queue-context.tsx` を L4 対応に拡張（`snapshot.sessions` / `session-started` / `session-ended` / `transcript-append` / `question` / `plan` 受信、`sessions`/`transcripts`/`pendingQuestions`/`pendingPlans` 保持、`answerQuestion`/`decidePlan`/`sendReply` 送信）。ルート `/sessions`（稼働セッション一覧・status ドット・要回答チップ）+ `/sessions/[id]`（transcript チャット自動スクロール + 質問/plan 回答 + 返信欄）。`components/SessionViews.tsx`（`TranscriptBubble`/`QuestionAnswer`/`PlanAnswer`/`ReplyComposer`、既存 `.a-*` クラス + CSS 変数で配色統一）。ホーム top bar に 💬 リンク（未回答で赤バッジ）。multiSelect は iOS/Mac と同じく `", "` 連結。検証: `pnpm --filter @vigili/pwa typecheck` + `build`（全6ルート生成）green、Biome 整形済み。

## 9. macOS Widget（Notification Center / Desktop）

### 9.1 責務

メニューバーアプリ本体を開かなくても、保留中の承認件数・本日の allow/deny・接続状態・直近 pending を一目で見られる observability サーフェス。`packages/app` の `VigiliWidget` ターゲット（macOS app-extension、`com.apple.widgetkit-extension`）。small/medium/large の 3 サイズ対応。

large の直近 pending 行は Mac popover の `ApprovalCard` と同じ要素でリッチ表示する: プロジェクト tag の色ドット（`AgentColor`）+ tool チップ（端末/鉛筆/地球アイコン + tool 名）+ 危険度ラベル（`RiskAssessment`: 危険=赤 / 要注意=amber）+ コマンド/パスのプレビュー、加えて各行に Allow/Deny ボタン（§9.3）。widget ターゲットは `AgentColor`/`RiskAssessment`/`ApprovalRequest` を持たないため、host(`AppCoordinator.refreshWidget`) がこれらを解決して `WidgetState.PendingItem`（`toolName`/`tag`/`tagColorHex`/`riskLabel`/`riskDanger`、旧 JSON 互換で全て Optional）に詰めて渡す。tag 色は host が `AgentColor.color → NSColor → #RRGGBB` に変換し、widget は `Color(hex:)` で描画。

### 9.2 データ共有（widget 自身のサンドボックスコンテナ）

Widget extension は本体アプリのメモリにアクセスできない（別プロセス）。本体 → widget は **単方向の JSON ファイル** `widget-state.json`（`WidgetState` を JSON 直列化）で受け渡す。

**不変条件: macOS の WidgetKit 拡張は App Sandbox 必須**。サンドボックス無効の widget extension は chronod / pkd が登録も読み込みもせず、ウィジェットギャラリーに現れない（ビルド・署名・埋め込みが正常でも、再起動でも、`pluginkit -a` でも登録されない）。一方、サンドボックス化した widget は `~/.vigili/` を直読みできない（ホームディレクトリはコンテナ外）。

当初は **App Group 共有コンテナ** を使う計画だったが、Personal/個人開発チームの **automatic signing が App Groups を含む provisioning profile を発行せず**（常に wildcard `Mac Team Provisioning Profile: *` が選ばれる）、サンドボックスが `~/Library/Group Containers/...` への読み取りを `deny(1) file-read-data` で拒否する。手動ポータル provisioning なしには成立しないため、**App Group を使わずに済む方式**に切り替えた:

**widget は「自分のサンドボックスコンテナ」を読み、host がそこへ書く。** サンドボックスアプリは自分のコンテナを entitlement / profile なしで常に読み書きでき、非サンドボックスの host は任意のユーザ所有パスに書けるので、provisioning に一切依存しない。

- 共有ファイル: `~/Library/Containers/io.vigili.app.shono.widget/Data/widget-state.json`（widget の sandbox コンテナ直下）。
- writer: 本体 `AppCoordinator.refreshWidget()` が pending/stats/wsState 変化時に `WidgetState.writeAtomically()` → `WidgetCenter.reloadTimelines(ofKind:)`。host は非サンドボックスなので上記絶対パスへ直接書き込む。
- reader: widget の `TimelineProvider` が `WidgetState.read()`。widget では `NSHomeDirectory()` が自分のコンテナ `Data` を指すので自然に同じファイルを読む。
- パス解決 `WidgetState.fileURL`（`Sources/Shared/WidgetState.swift`、両ターゲットで共有）の優先順位: ①`$VIGILI_HOME`/`$SENTINEL_HOME` 上書き（テスト・CLI 用）→ ②widget のサンドボックスコンテナ（`Bundle.main.bundleIdentifier` で widget/host を判別し、widget は `NSHomeDirectory()/widget-state.json`、host は `<実ホーム>/Library/Containers/io.vigili.app.shono.widget/Data/widget-state.json`）。

entitlements:

- 本体 `Vigili`: `app-sandbox=false`（node spawn / unix socket / `~/.vigili` 直読みのため意図的）。
- widget `VigiliWidget`: `app-sandbox=true`（必須）。
- `application-groups` entitlement は上記事情で**不使用**（残置しても無害だが、データ経路には関与しない）。

配布は Developer ID + notarization（App Store 対象外）。widget は自分のコンテナを読むだけなので追加 capability は不要。

### 9.3 widget からの Allow/Deny（インタラクティブ widget）

macOS 14+ の interactive widget（`Button(intent:)` + App Intents）で、large widget の直近 pending 各行に Allow/Deny ボタンを置く。サンドボックスの widget は daemon socket に届かないため、決定は **widget→host の逆方向コンテナ IPC** で流す（§9.2 の状態受け渡しと対称）。

- widget: タップで `DecideRequestIntent`（`VigiliPendingWidget.swift`）が発火し、`WidgetState.writeDecision(id:decision:)` で widget コンテナ下 `decisions/<request_id>.json` を書く。
- host: `AppCoordinator` が毎 tick（1s）で `WidgetState.drainDecisions { id, decision in decide(...) }`。decisions/ の各ファイルを読み、`allow`/`deny` のみ受理して daemon に適用（`decide(id:decision:)` → WS `decide`）、ファイルを削除。適用後は resolved → `refreshWidget()` で widget も自動更新。
- パス解決 `WidgetState.decisionsDir` は `fileURL` と同じ要領で widget/host どちらの process でも同じ絶対パスを返す（widget は `NSHomeDirectory()`、host は実ホーム配下の widget コンテナ）。
- 検証: macOS（`-scheme Vigili`）CLI ビルド green。

## 10. アカウント中心オンボーディング（Sign in with Apple）

### 10.1 動機

旧オンボーディングは開発者向け手順（ターミナル `vigili-cli pair` → email/password → QR → daemon 手動再起動 → iPhone スキャン）で、一般ユーザーに出せない。2026-06 のプロダクト化転換に伴い、**ターミナル不要・QR 不要・パスワード不要**のフローへ移行する。ログインは **Sign in with Apple 主軸**。既存の email/password + QR 経路は後方互換フォールバックとして温存する。

### 10.2 アーキテクチャ決定

1. **Apple ネイティブ検証**: Mac/iOS アプリが Apple から `identityToken` (JWT) を取得し、relay `POST /v1/auth/apple` に `{identity_token, nonce}` を送る。relay は JWKS で署名検証し、`iss=https://appleid.apple.com` / `aud ∈ 許可 bundle id` / `exp` / `nonce==sha256(rawNonce)` を確認、`sub` でアカウントを find-or-create し session を発行。Services ID / 秘密鍵はネイティブ検証では不要（将来 PWA をやる時のみ）。
2. **アカウント = テナント境界**: 同一 Apple `sub` の Mac (agent) と iPhone (client/device) を relay が束ねる。QR でのトークン転送を廃し、両端が同じアカウントにサインインするだけでリンクが成立。
3. **hub の account 単位 fan-out**: 既存の per-pairing 経路（`/v1/agents/:pid`, `/v1/clients/:pid`）を維持しつつ、account-stream client（`/v1/account/stream`）を追加。agent のメッセージは「その pairing の legacy clients」と「その account の account-stream clients」の両方へ配信。client→agent（decide 等）は account 内の全 agent へブロードキャスト（`request_id` は一意なので所有 daemon のみ反応）。
4. **daemon が config.yaml の唯一の書き手**: Mac アプリは新 admin アクション `relay-configure` を送るだけで、daemon が config 永続化と relay の**ホット再接続**を行う（`launchctl kickstart` 依存を撤廃）。
5. **session token は Keychain 保管**（UserDefaults 不可）。

### 10.3 relay の追加 API / スキーマ

- `accounts` に `apple_sub TEXT`（nullable, partial unique index）を追加。`password_hash` は nullable（Apple アカウントは空文字 sentinel で signin を実質閉じる）。
- `POST /v1/auth/apple {identity_token, nonce}` → `{account{id,email?}, session{token, expires_at}}`。
- `POST /v1/account/devices {apns_token, platform}`（session 認証, pairing_id=null）。
- WS `/v1/account/stream?token=<session>`（session 認証 → account_id）。
- `maybePushApns` は pid→account_id を解決し `listDevicesForAccount` で**アカウント内全 device**へ push（apns_token で de-dup）。
- env `APPLE_AUD`（CSV、既定 `io.vigili.app.shono,io.vigili.mobile.shono`）。検証ライブラリは `jose`。

### 10.4 クライアント（Mac / iOS）

- 共通 (Sources/Shared): `AppleSignIn`（`ASAuthorizationController` + nonce）、`KeychainStore`（`kSecAttrAccessibleAfterFirstUnlock`、アクセスグループ無し）、`RelayAuthClient`（`/v1/auth/apple`, `/v1/pairings`, `/v1/account/devices`）。
- Mac: 「Claude Code に接続」= `HookInstaller`（`~/.claude/settings.json` に PreToolUse hook を冪等・非破壊で追加）+ daemon 起動。「Sign in with Apple」= サインイン → `createPairing` → `relay-configure` admin で daemon をホット再接続。
- iOS: 「Sign in with Apple」= サインイン → `accountSessionToken`(Keychain) 保存 → `POST /v1/account/devices` で APNs 登録 → account-stream へ接続。`reevaluateRoute` 優先順位は **Bonjour LAN > account-stream > legacy relay > static LAN > none**。QR スキャンは副 CTA としてフォールバック維持。
- entitlements: 両ターゲットに `com.apple.developer.applesignin = [Default]`。Apple Developer Console で両 App ID に Sign in with Apple capability を有効化（paid program 必須）。
