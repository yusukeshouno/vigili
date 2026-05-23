# Sentinel — Implementation Plan

実装順序とマイルストーン。各 Phase は終わった時点で実際に動作確認できる単位で区切ります。

---

## Phase 0: リポジトリセットアップ（30 分）

- [ ] `pnpm init`、workspaces 設定
- [ ] `packages/{gate,daemon,shared,pwa}` のスケルトン
- [ ] TypeScript 設定（strict, ESM, NodeNext）
- [ ] Biome 設定
- [ ] vitest 設定
- [ ] `.gitignore`、`.editorconfig`
- [ ] `pnpm install` が通ることを確認

**Done の定義**: `pnpm -r build` がエラーなく通る。

---

## Phase 1: shared パッケージ（30 分）

すべての層が依存する型定義。先に作る。

- [ ] zod スキーマ
  - `ToolRequestSchema`（gate → daemon）
  - `DecisionSchema`（daemon → gate）
  - `ApprovalRequestSchema`（DB 永続化用）
  - `WsMessageSchema`（PWA ↔ daemon）
- [ ] 型 export
- [ ] テスト（最小限のバリデーション確認）

**Done の定義**: `import { ToolRequestSchema } from "@sentinel/shared"` が他パッケージから動く。

---

## Phase 2: daemon の最小実装（2 時間）

PWA なしで、CLI から承認できるところまで。

- [ ] Unix domain socket サーバ起動
- [ ] policy.yaml のロード＆バリデート
- [ ] ハードコード invariants の実装
- [ ] ポリシー判定ロジック（allow/deny のみ、ask は未対応）
- [ ] SQLite 初期化＆マイグレーション
- [ ] 全リクエストを DB に記録
- [ ] `sentinel-daemon start/stop/status` CLI
- [ ] `sentinel-cli history` CLI（DB 閲覧）

**Done の定義**: 手で curl っぽくソケットに JSON 流したら正しい decision が返る。テスト：

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"ls"},"cwd":"/tmp","session_id":"test"}' \
  | nc -U ~/.sentinel/daemon.sock
# → {"decision":"allow"}
```

---

## Phase 3: gate の実装（1 時間）

- [ ] stdin から Claude Code hook JSON を受ける
- [ ] daemon socket に転送
- [ ] decision に応じて exit code を返す
- [ ] daemon 不在/タイムアウト時は exit 2
- [ ] `--session` `--tag` フラグ
- [ ] 実際に Claude Code の hook 設定に組み込んで動作確認

**Done の定義**: `~/.claude/settings.json` に hook を仕込み、`ls` を実行すると Sentinel ログに記録される。`rm -rf /` を試すと invariants でブロックされる。

---

## Phase 4: ask 機能と WebSocket（2 時間）

人間に問う経路を実装。ただし PWA はまだなので curl で承認する。

- [ ] daemon に ask 処理を追加（保留キュー）
- [ ] gate 側の ask 待機（同じソケットで結果待つ）
- [ ] WebSocket サーバ起動
- [ ] token 認証
- [ ] `pending` `resolved` `snapshot` メッセージ実装
- [ ] `decide` メッセージ実装（promote はまだ無視）
- [ ] `sentinel-cli pending` `approve` `deny` を実装

**Done の定義**: `ask` ルールに該当する操作を流すと、gate がブロックする。別ターミナルで `sentinel-cli approve <id>` を打つと gate が解放される。

---

## Phase 5: ntfy 通知（30 分）

- [ ] config.yaml ロード
- [ ] ask 発生時に ntfy.sh に POST
- [ ] priority マッピング

**Done の定義**: スマホの ntfy アプリに通知が届く。

---

## Phase 6: PWA — Queue 画面（3 時間）

- [ ] Next.js 15 セットアップ（App Router、Tailwind v4）
- [ ] token 入力画面
- [ ] WebSocket 接続ロジック
- [ ] Queue 画面（カードリスト、リアルタイム更新）
- [ ] スワイプ操作（react-swipeable など）
- [ ] セッションタグの色分け
- [ ] 経過秒数のライブ更新

**Done の定義**: Tailscale 経由でスマホからアクセスし、保留中のリクエストが見える。スワイプで承認できる。

---

## Phase 7: PWA — Detail 画面とルール昇格（2 時間）

- [ ] Detail 画面（フルコマンド表示）
- [ ] ルール昇格モーダル
- [ ] 正規表現の自動提案ロジック
- [ ] daemon 側の policy.yaml 追記処理
- [ ] policy reload

**Done の定義**: 承認時に「同じパターンは今後自動許可」を選ぶと policy.yaml にルールが増え、次回から ask されない。

---

## Phase 8: Service Worker と push 通知（1.5 時間）

- [x] PWA manifest
- [x] Service Worker 登録
- [x] iOS Safari への「ホーム画面に追加」誘導 UI (Phase 10 で完全化)
- [x] ntfy の通知タップで PWA 起動 → 該当 Detail 画面へ

---

## Phase 9: 監査と統計（1 時間）

- [x] `sentinel-cli stats --today`（自動許可 N 件、人間判定 M 件、平均応答時間）
- [ ] PWA に「今日のサマリー」画面（任意）
- [x] DB の自動アーカイブ（30 日以前）

**Done の定義**: 1 日使い終わって `sentinel-cli stats --today` を打つと当日の運用が見える。

---

## Phase 10: Web Push native notifications（2 時間）

ntfy.sh を使わず、PWA 直結の Web Push API で iOS / Android / Desktop に直接通知を飛ばす。
第三者サーバ非依存、タップで該当 /r/<id> 画面が直接開く。

- [x] shared に `PushSubscriptionJson` / `PushPayload` zod スキーマ
- [x] daemon: `web-push` ライブラリ追加、VAPID 鍵を `~/.sentinel/vapid.json` に永続化
- [x] daemon: subscription を `~/.sentinel/push-subs.json` に atomic JSON 保存
- [x] daemon: Fastify HTTP routes `/push/vapid-public-key` `POST/DELETE /push/subscriptions`
- [x] daemon: `WebPushNotifier` 実装、410/404 で自動 prune
- [x] daemon: `multiNotifier` で ntfy と Web Push を並列 fan-out 可能に
- [x] PWA: `enableNativePush()` / `disableNativePush()` / `getPushStatus()` helpers
- [x] PWA: setup ページに `<NotificationsCard>` で enable/disable UI
- [x] sw.js: `push` イベントで `showNotification`、`critical` は `requireInteraction: true`
- [x] テスト: 14 本 (VAPID 生成 / SubscriptionStore / buildPayload / fan-out / 410 prune / 500 残存)

**Done の定義**: iOS PWA をホーム画面に追加 → setup で Enable → 承認待ちが発生したら端末に直接通知が届く。

---

## Phase 11: 永続化と運用整備（1 時間）

Mac 再起動後も手動操作なしで daemon と PWA が立ち上がり、運用ラッパーも
自然な UX で使える状態にする。

- [x] `scripts/sentinel-daemon` / `sentinel-cli` / `sentinel-gate` の wrapper
- [x] `~/.local/bin/` に symlink 配置 (PATH 編集不要)
- [x] Claude Code hook を `sentinel-gate` シンボリック経由に切替
- [x] `~/Library/LaunchAgents/io.sentinel.daemon.plist` (KeepAlive=true, ThrottleInterval=10)
- [x] `~/Library/LaunchAgents/io.sentinel.pwa.plist` (next start -p 3737)
- [x] wrapper が launchd 管理を検出し、restart は kickstart -k 経由
- [x] policy.yaml に wrapper / launchctl / kill -HUP ルールを追記

**Done の定義**: `sudo reboot` 後、追加操作なしで Mac の Wake → daemon + PWA 起動 → iPhone から PWA 接続 → 承認できる。

**ハマりどころのメモ** (次回これを書き直す人へ):
- `KeepAlive: { SuccessfulExit: false }` だと SIGTERM 正常終了で再起動しない。
  常駐させたいプロセスは `KeepAlive: true` (常時)。
- policy.yaml の "Sentinel 内部 CLI" は `^node /...sentinel/packages/.../dist/cli.js` のみマッチ。
  wrapper script (`sentinel-daemon stop` 等) は別ルールで明示的に許可が必要。
- launchctl の操作 (`kickstart`/`bootout`/`bootstrap`) もポリシーで `io.sentinel.` プレフィックス限定で許可しておく。

---

## Phase 12: Sentinel.app — Mac メニューバーアプリ化（〜2 週間）

Sentinel をネイティブな Mac アプリにし、launchd スクリプトを表に出さなくする。
メニューバーから ask カードをその場で承認、PWA は WKWebView で内蔵ウィンドウ表示。
iPhone PWA は引き続き別チャンネルとして共存。

### 設計の確定事項

| 項目 | 決定 |
|---|---|
| UI フレームワーク | SwiftUI + AppKit (NSStatusItem, NSPopover, NSWindow) |
| ターゲット | macOS 13 (Ventura) 以降 (SMAppService for 自動起動) |
| バンドル ID | `io.sentinel.app` |
| LSUIElement | true (Dock アイコンなし、メニューバーのみ) |
| daemon プロセス | アプリの子プロセスとして spawn、quit 時に SIGTERM、クラッシュ時に再起動 |
| pwa プロセス | 同上 (Mac 用 WKWebView も localhost:3737 を見る) |
| 既存 launchd plist | アプリ初回起動時に検出 → bootout してアプリ側に移行 |
| token / VAPID | 引き続き `~/.sentinel/` 配下のファイル (Keychain 移行は後回し) |
| 名前 / アイコン | 現状の "Sentinel" + 4 弁花ロゴ。メニューバー用にモノクロ調整 |

### サブフェーズ

#### 12-A: スケルトン + daemon 子プロセス (3〜4 日)

- [ ] `packages/app/` に Xcode プロジェクト (xcodegen で `project.yml` から生成)
- [ ] NSStatusItem (メニューバーアイコン)
- [ ] NSPopover (空、240×400 程度)
- [ ] `DaemonController.swift`: `Process` で daemon を spawn、stdout/stderr を log buffer に
- [ ] アプリ終了時に SIGTERM、クラッシュ時に exponential backoff で再起動
- [ ] `SMAppService` で自動ログイン起動を有効化
- [ ] 既存の `io.sentinel.daemon.plist` を検出したら bootout する移行ロジック

#### 12-B: status + 今日のサマリー (2〜3 日)

- [ ] `DaemonAdminClient.swift`: Unix socket で `kind: "admin"` プロトコルを話す
- [ ] 1 秒ポーリングで pending 数を取得、メニューバーアイコンにバッジ
- [ ] ポップオーバー上部に「N pending」+「Today: 372 allow, 22 deny, median 17s」
- [ ] `sentinel-cli stats` の集計を re-implement (Swift 側で daemon の DB を直接読むか、admin プロトコルに stats アクションを追加)

#### 12-C: 対話的 ask カード (3〜4 日)

- [ ] `DaemonWsClient.swift`: `URLSessionWebSocketTask` で WS 接続 (token auth)
- [ ] `pending` メッセージで来る ApprovalRequest を ObservableObject にためる
- [ ] SwiftUI で ApprovalCard を作る (現在の React 版と同じ情報密度)
- [ ] Allow / Deny ボタン → WS で `decide` を送信
- [ ] "Promote to rule" シート (Cmd+Shift+R) で promote
- [ ] 通知センターに NSUserNotification も出す (iPhone と並列、Mac でも視認性向上)

#### 12-D: PWA を WKWebView で内蔵 (2〜3 日)

- [ ] `PwaWindowController.swift`: WKWebView でロード
- [ ] Cmd+Shift+S をグローバルホットキー登録 (Carbon RegisterEventHotKey)
- [ ] 接続先は `http://localhost:3737/` (Mac 内ループバック、Tailscale 不要)
- [ ] `pwa` プロセスもアプリの子プロセスとして管理
- [ ] iPhone 用の Tailscale URL はメニューバーから「Copy iPhone URL」ボタンで取得可能に

#### 12-E: 初回起動ウィザード (2〜3 日)

- [ ] `~/.claude/settings.json` を検出し、PermissionRequest hook を追加するか確認
- [ ] `~/.sentinel/policy.yaml` が無ければ policy.example.yaml をコピー
- [ ] Tailscale CLI を検出、無ければインストール案内 (`brew install --cask tailscale`)
- [ ] VAPID 鍵を読み込み、QR コードに `https://<tailscale>/` + token を埋め込んで iPhone セットアップを支援

#### 12-F: 配布 (1〜2 日)

- [ ] Developer ID で署名
- [ ] xcrun notarytool で notarize
- [ ] create-dmg で `.dmg` を作成
- [ ] (任意) Sparkle で自動アップデート
- [ ] README に「Sentinel.app をダウンロード → ドラッグ&ドロップ」フロー

### 既存資産の扱い

- **launchd plist** は 12-A の bootout 処理で除去。
- **wrapper scripts** (`sentinel-daemon` 等) はそのまま残す (CLI 派の自分用、CI/テスト用)。
- **policy.yaml の wrapper / launchctl / kill -HUP ルール**は引き続き必要。
- **iPhone 用 PWA + Tailscale serve** は変えない (アプリは PWA をホストしない、daemon 経由の Web Push もそのまま)。

### Done の定義

- App Store ではなく `.dmg` 配布で動作。
- 起動 → メニューバーに花アイコン → ポップオーバーで pending カードが出て承認できる。
- Cmd+Shift+S で PWA ウィンドウが出る。
- 再起動後も自動起動。
- iPhone PWA との並行運用が壊れない。

---

## Phase 13: Sentinel iOS — ネイティブアプリ (〜1 週間)

iPhone を取り出した瞬間にロック画面で「N pending」が常駐、タップで Allow/Deny。
ホーム画面アイコンから native UX で動く、PWA を退役。

- [x] 13-A: iOS target 追加、Shared/SentinelMobile 構造、Setup/Queue 画面
- [x] 13-B: QR スキャナーで Setup ワンタップ
- [x] 13-C: ActivityKit で Live Activity (Lock screen + Dynamic Island)
- [x] 13-D: `sentinel://setup?u=...&t=...` URL scheme でゼロタップ設定
- [x] 13-E: Tailscale を捨てて LAN 直接 + Bonjour 自動検出 (zero-config)
- [ ] 13-F: APNs (Apple Developer 加入完了後) で背景でも通知届く
- [ ] 13-G: Allow / Deny を 通知バナー / Live Activity に (App Intents iOS 17+)

**Done の定義**: iPhone をロックしたまま、ロック画面の Live Activity で Allow / Deny できる。

---

## Phase 14: Sentinel Cloud — 商用版 (3〜4 週間)

「個人 OSS」から「販売できる商品」へ。エンドユーザに `brew install cloudflared` 等の
追加セットアップを要求しない構成にし、App Store で配布できる形にする。

### 設計の確定事項

| 項目 | 決定 |
|---|---|
| バックエンド | 販売者の VPS に **Sentinel Relay** (Node + Fastify + ws) を常駐 |
| Mac クライアント | **outbound WSS** で Relay に常時接続 (inbound listen は LAN モード時のみ) |
| iOS クライアント | LAN なら Bonjour 直接、外出時は Relay 経由で fallback |
| 通知 | 販売者の APNs key (.p8) で中央集権的に push 送信 |
| ペアリング | Mac でアカウント作成 → QR に PAIRING_ID + USER_TOKEN を埋める → iPhone がスキャン |
| 課金 | App Store IAP (auto-renewable subscription、無料試用 14 日) |
| 配布 | iOS App Store、Mac は Developer ID + notarize で `.dmg` 直配布 (or Mac App Store) |
| 価格帯 (検討中) | 月 $4〜6 / 年 $40〜50 / 無料試用 14 日 |

### サブフェーズ

#### 14-A: Sentinel Relay (3〜5 日)

- [ ] `packages/relay/` を新設 (Fastify + ws + Postgres or SQLite)
- [ ] `/agents/<pairing-id>` 認証付き WSS (Mac daemon が outbound 接続)
- [ ] `/clients/<pairing-id>` 認証付き WSS (iOS app が outbound 接続)
- [ ] pairing-id ごとに WS メッセージを fan-out
- [ ] アカウント / pairing 作成 API
- [ ] VPS デプロイ (systemd or Docker、TLS は Caddy or Let's Encrypt)

#### 14-B: Mac daemon の outbound モード (2 日)

- [ ] config に `relay: { url, agent_key }` セクションを追加
- [ ] `RelayClient` を daemon に追加 (WSS reconnect、message 双方向)
- [ ] 既存の inbound WS (LAN モード) は残し、両モード並行
- [ ] decide / pending / resolved の message を双方ルーティング

#### 14-C: iOS app の relay 統合 (2 日)

- [ ] `MobileSettings` に `relayUrl` / `userToken` を追加
- [ ] `DaemonWsClient` を multi-endpoint 化: LAN 試行 → 2 秒 timeout → relay にフォールバック
- [ ] LAN 失敗時の UX: 「Connecting via cloud…」表示

#### 14-D: APNs 統合 (3 日)

- [ ] 販売者 Apple Developer に APNs Key (.p8) を作成、Relay に登録
- [ ] iOS app: `UNUserNotificationCenter` 許可 + `registerForRemoteNotifications`、device token を Relay に POST
- [ ] Relay: pending が来たら subscriber の device token に APNs Push (node-apn) で送信
- [ ] Live Activity push token も同じ経路で更新 → 背景時もロック画面が live 更新

#### 14-E: ペアリング (3〜5 日)

- [ ] Mac app: 初回起動でサインアップ画面 (Email + Password、Apple Sign In)
- [ ] Relay: ユーザ作成 / ログイン / セッショントークン発行
- [ ] Mac app: ペアリング QR を生成 (PAIRING_ID + USER_TOKEN 入り、サインインしたユーザに紐付く)
- [ ] iOS app: 初回起動でこの QR をスキャン or 同じ Apple ID で auto pair
- [ ] Settings 画面でデバイス一覧 / アクティブセッション管理

#### 14-F: 課金 (3〜5 日)

- [ ] App Store Connect で IAP 商品作成 (月 / 年プラン、無料試用 14 日)
- [ ] iOS app: `StoreKit 2` で購入フロー
- [ ] Mac app: StoreKit (Mac App Store なら可、Direct distribution なら Stripe)
- [ ] Relay: subscription validation (App Store の receipt 検証)
- [ ] 試用期間 / 無料 / Pro の差別化 (例: 自動許可ルール数上限など)

#### 14-G: App Store 申請物 (1 週間)

- [ ] iOS app の App Store スクリーンショット (各サイズ)
- [ ] Mac app の Developer ID 署名 + notarize + `.dmg`
- [ ] プライバシーポリシー / 利用規約 サイト (静的サイト or Notion 公開)
- [ ] App Store 説明文 (日本語 / 英語)
- [ ] サポート用メールアドレス + サイト
- [ ] App Review 用テストアカウント
- [ ] App Privacy 設定 (収集データの開示)

### Done の定義

- App Store で公開、誰でもインストールできる
- 初回起動: Apple ID でサインアップ → ペアリング QR → 自宅でも外出先でも動く
- 月額サブスクリプションが課金される
- VPS 上の Relay が安定稼働 (uptime monitoring 含む)

### 既存資産の扱い

- **Self-hosted モード** (今までの構成) は **OSS として残す**。Free 利用層を作る。
- 商用版は Cloud Edition として有償。コードベースは monorepo で同居 (Plausible / Posthog 型)。

---

## マイルストーン一覧

| Phase | 累積時間 | 動作する範囲 |
|---|---|---|
| 0-3 | 〜4h | 自動許可・自動拒否は完全動作、ask は未対応 |
| 4-5 | 〜7h | CLI とスマホ通知で承認できる、PWA なし |
| 6-7 | 〜12h | スマホで承認とルール昇格ができる |
| 8-9 | 〜15h | 全機能完成 |

週末で Phase 0-5 まで、平日夜で Phase 6-9 が現実的。

---

## 後回しにすること

- Apple Watch Complication（PWA では限界がある、ショートカットで代替）
- バッチ承認（同一パターン連続時のまとめ承認）
- Slack / Discord 通知（ntfy で十分）
- マルチユーザー
- Web UI からのポリシー編集（YAML 直書きで十分）
- メトリクス可視化ダッシュボード

---

## リスクと対策

| リスク | 対策 |
|---|---|
| Claude Code Hooks の仕様変更 | gate を薄く保ち、変更追従コストを最小化 |
| daemon プロセスが死ぬ | launchd で自動再起動、gate はフェイルセーフ deny |
| Tailscale が落ちて承認できない | timeout で deny、後で再実行 |
| ポリシーが暴走して全部 allow になる | invariants でハードガード、毎日サマリーで監査 |
| SQLite が破損 | 起動時に整合性チェック、壊れたら新規作成 |
