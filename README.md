# Vigili

Claude Code の承認プロンプトを、ローカルデーモンが奪取してポリシー判定し、必要なときだけ手元のスマホに飛ばすシステム。

複数の Claude Code セッションを並列に走らせるとき、承認画面を見張る人間時間を回収するためのもの。

---

## 何が起きるか

通常:

```
Claude Code: "pnpm install を実行しますか? (y/n)" ← ターミナルに戻って y を押す
```

Vigili 導入後:

```
Claude Code: (Vigili が自動許可、ターミナルは止まらない)
```

危険な操作のみ:

```
スマホに通知 → PWA を開いて右スワイプ → Claude Code が続行
```

---

## ダウンロード

**[最新リリース (DMG)](https://github.com/yusukeshouno/vigili/releases/latest)** — Developer ID 署名・Apple 公証済み。macOS 13 (Ventura) 以降。

DMG を開いて Vigili.app を Applications にドラッグするだけ。iOS アプリは App Store 公開準備中です。

---

## セットアップ

> **オンボーディング（推奨・ターミナル不要）**
>
> Vigili.app を開き、Welcome 画面で:
>
> 1. **「Claude Code に接続」** を押す → PreToolUse hook が `~/.claude/settings.json` に自動追加され、daemon が起動する（手動の hook 編集・`vigili-daemon start` は不要）。
> 2. **「Sign in with Apple」** を押す → relay にこの Mac の pairing が作られ、daemon が**再起動なしで** relay へ接続する。
> 3. iPhone で Vigili を開き、**「Sign in with Apple」**（同じ Apple ID）→ QR もパスワードも無しでアカウントに自動リンクし、APNs 通知が届くようになる。
>
> 前提（一度だけ）: Apple Developer Console で `io.vigili.app.shono` と `io.vigili.mobile.shono` の両 App ID に **Sign In with Apple** capability を有効化する。
>
> 以降の「### 1〜6」は手動 / 開発者向けの詳細手順（`vigili-cli pair` の QR 経路を含む）で、上記 GUI フローのフォールバックとして引き続き使えます。

### 必要なもの

- macOS（Mac mini / Mac Studio で確認）
- Node.js 22+
- pnpm
- 有償 Apple Developer Program（Sign in with Apple / APNs に必要）
- Tailscale（任意・LAN 直結の PWA 接続用）

### 1. ビルド

```bash
git clone <repo> sentinel
cd sentinel
pnpm install
pnpm -r build
pnpm -r --filter "./packages/*" link --global
```

### 2. 初期設定

```bash
mkdir -p ~/.sentinel
cp policy.example.yaml ~/.sentinel/policy.yaml

cat > ~/.sentinel/config.yaml <<EOF
daemon:
  socket_path: ~/.sentinel/daemon.sock
  ws_port: 7878
  db_path: ~/.sentinel/queue.db

ntfy:
  server: https://ntfy.sh
  topic: sentinel-yusuke-$(openssl rand -hex 8)
EOF
```

### 3. デーモン起動

```bash
sentinel-daemon start
sentinel-daemon status
```

launchd で常駐させる場合:

```bash
sentinel-daemon install-service
```

### 4. Claude Code に hook を仕込む

`~/.claude/settings.json` を編集:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash|Edit|Write|WebFetch",
      "hooks": [{
        "type": "command",
        "command": "sentinel-gate --session $CLAUDE_SESSION_ID"
      }]
    }]
  }
}
```

これで次回以降の Claude Code セッションから Sentinel 経由になります。

### 5. PWA セットアップ

Tailscale Funnel で PWA を公開:

```bash
cd packages/pwa
pnpm build
pnpm start &
tailscale funnel 3000
# → https://<your-machine>.tail-XXXX.ts.net が割り当てられる
```

iPhone Safari でアクセスし、「ホーム画面に追加」。初回起動時に token を入力:

```bash
cat ~/.sentinel/token
```

### 6. ntfy 通知

iPhone の ntfy アプリで `~/.sentinel/config.yaml` の topic を Subscribe。

---

## 日常運用

### 承認パターンを育てる

最初は `ask` が多めに発生します。同じパターンが繰り返し聞かれたら、PWA の Detail 画面で `Allow & promote to rule` を押すと policy.yaml にルールが追加されます。

### ポリシー編集

直接 YAML を編集してから:

```bash
sentinel-daemon policy validate
sentinel-daemon policy reload
```

### 監査

```bash
sentinel-cli stats --today
# → 自動許可: 127 件 / 人間判定: 8 件 / 自動拒否: 2 件
#   平均応答時間: 12s

sentinel-cli history --today
```

### トラブルシュート

承認できなくて Claude Code が止まる場合:

```bash
sentinel-daemon status                # 動いてるか
sentinel-daemon logs --follow         # ログ確認
sentinel-cli pending                  # 保留キュー確認
sentinel-cli approve <id>             # CLI からも承認可能
```

デーモンを止めて Sentinel を一時的に外したい場合は hook を一時無効化:

```bash
# ~/.claude/settings.json の hooks セクションをコメントアウト
```

---

## ファイル配置

```
~/.sentinel/
├── policy.yaml          # ポリシー本体
├── config.yaml          # daemon 設定
├── token                # PWA 認証トークン
├── daemon.sock          # gate ↔ daemon Unix socket
├── daemon.log           # daemon ログ
└── queue.db             # SQLite 監査ログ
```

---

## 設計思想・詳細仕様

- `CLAUDE.md` — プロジェクト規約と設計原則
- `SPEC.md` — 機能仕様
- `IMPLEMENTATION_PLAN.md` — 実装順序

---

## 安全上の注意

- ポリシーで `allow` ルールを書きすぎると危険です。`stats` で自動許可件数を毎日確認してください。
- `rm -rf /` などの破壊的操作はハードコードされた invariants で常に deny されます。これは policy.yaml で上書きできません。
- Tailscale Funnel は外部からアクセス可能なので、token を漏らさないでください。漏れたら `~/.sentinel/token` を削除して daemon を再起動すれば再生成されます。
