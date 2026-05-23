# Sentinel — Functional Specification

このドキュメントは Sentinel の機能仕様を定義します。実装と仕様が乖離した場合、こちらを真とします。

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
