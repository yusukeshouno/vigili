# @vigili/relay

販売者の VPS で常駐させる WebSocket リレー。Mac (Sentinel Agent) と iPhone
(Sentinel Client) をペアリングし、メッセージを fan-out、APNs Push を送る。

## 役割

```
[Mac daemon] ─── outbound WSS ───▶ ┌──────────────────────┐ ◀── outbound WSS ─── [iPhone app]
                                   │  Sentinel Relay      │
                                   │  - /v1/agents/<pid>   │ ─ APNs Push ─▶ [iPhone Lock screen]
                                   │  - /v1/clients/<pid>  │
                                   │  - pairing-id ごとに  │
                                   │    fan-out + auth     │
                                   │  - SQLite 永続化      │
                                   └──────────────────────┘
```

## エンドポイント

| Path | Auth | 用途 |
|---|---|---|
| `GET  /healthz` | none | 死活監視 (Caddy / uptime) |
| `POST /v1/signup` | none | アカウント作成 (email + password) |
| `POST /v1/signin` | credentials | セッショントークン取得 |
| `POST /v1/signout` | session | 現在のセッション失効 |
| `GET  /v1/me` | session | 自分のアカウント情報 |
| `POST /v1/pairings` | session | ペアリング作成 (AGENT_KEY / USER_TOKEN 発行、初回のみ平文返却) |
| `GET  /v1/pairings/me` | session | 自分のペアリング一覧 (agent_online 付き) |
| `DELETE /v1/pairings/:pid` | session | ペアリング削除 |
| `POST /v1/devices` | session | iOS APNs device token 登録 (Phase 14-D の APNs Push 用) |
| `DELETE /v1/devices/:apnsToken` | session | APNs token 抹消 |
| `WSS  /v1/agents/:pid` | agent key (Bearer or `?token=`) | Mac → Relay |
| `WSS  /v1/clients/:pid` | user token (Bearer or `?token=`) | iPhone → Relay |

予定 (Phase 14-D 以降): `POST /v1/subscriptions/verify` (App Store IAP receipt 検証)

## メッセージプロトコル

WS のメッセージは既存 daemon の `WsServerMessage` / `WsClientMessage` をそのまま転送する
(snapshot / pending / resolved / decide)。Relay は中身を見ず、pairing-id だけ
見て fan-out する。

ただし relay が独自に挿入するメッセージ:
- `{ "type": "agent-status", "online": boolean }`
  - クライアント接続直後に 1 通
  - エージェント接続 / 切断のたびに各 client に broadcast

## 認証情報の保存方式

- `accounts.password_hash` … scrypt (Node 標準) でハッシュ化
- `pairings.agent_key_hash` / `user_token_hash` … sha256
  - トークン本体 (AGENT_KEY / USER_TOKEN) は **発行時に一度だけ平文で返す**。
    保管は呼び出し側 (Mac app / iOS app) の責務。
- `sessions.token_hash` … sha256、TTL 30 日

## 開発

```bash
pnpm --filter @vigili/relay typecheck
pnpm --filter @vigili/relay test       # vitest (29 tests)
pnpm --filter @vigili/relay dev        # tsc --watch
pnpm --filter @vigili/relay start      # cli.ts を起動
```

## 起動環境変数

| Name | Default | 用途 |
|---|---|---|
| `PORT` | `3030` | 待受ポート |
| `HOST` | `0.0.0.0` | 待受 IF |
| `RELAY_DB` | `~/.sentinel/relay.db` | SQLite ファイル。`:memory:` 可 |

## 動作確認 (curl + websocat)

```bash
# 1. signup
curl -s localhost:3030/v1/signup -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"password1234"}' | jq .
# → { account, session: { token, expires_at } }

# 2. pairing 発行
TOKEN=...   # session.token
curl -s localhost:3030/v1/pairings -X POST \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"macbook-pro"}' | jq .
# → { id, agent_key, user_token, ... }

# 3. agent 側
websocat "ws://localhost:3030/v1/agents/<PID>?token=<AGENT_KEY>"

# 4. client 側 (別ターミナル)
websocat "ws://localhost:3030/v1/clients/<PID>?token=<USER_TOKEN>"
# 接続後 agent から流したメッセージがそのままここに届く
```

## デプロイ (予定)

systemd + Caddy で TLS 終端する一般的な Node サーバ運用。

```
/etc/systemd/system/sentinel-relay.service
Caddyfile: relay.sentinel.app { reverse_proxy localhost:3030 }
```

## 状態

- [x] Phase 14-A: DB + auth + REST + WS fan-out
- [ ] Phase 14-B: Mac daemon の outbound mode 統合
- [ ] Phase 14-C: iOS app の relay 統合 (LAN フォールバック)
- [ ] Phase 14-D: APNs Push (device token → 通知)
- [ ] Phase 14-E: ペアリング QR (Mac UI 側)
- [ ] Phase 14-F: App Store IAP 検証
