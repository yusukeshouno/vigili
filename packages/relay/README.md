# @sentinel/relay

販売者の VPS で常駐させる WebSocket リレー。Mac (Sentinel Agent) と iPhone
(Sentinel Client) をペアリングし、メッセージを fan-out、APNs Push を送る。

## 役割

```
[Mac daemon] ─── outbound WSS ───▶ ┌──────────────────────┐ ◀── outbound WSS ─── [iPhone app]
                                   │  Sentinel Relay      │
                                   │  - /agents/<pid>      │ ─ APNs Push ─▶ [iPhone Lock screen]
                                   │  - /clients/<pid>     │
                                   │  - pairing-id ごと    │
                                   │    に fan-out         │
                                   │  - subscription auth  │
                                   └──────────────────────┘
```

## エンドポイント (予定)

| Path | Auth | 用途 |
|---|---|---|
| `POST /v1/signup` | none | アカウント作成 (Apple Sign In or email+password) |
| `POST /v1/signin` | credentials | セッショントークン取得 |
| `POST /v1/pairings` | session | ペアリング ID と AGENT_KEY / USER_TOKEN を発行 |
| `GET  /v1/pairings/me` | session | 自分のペアリング一覧 |
| `POST /v1/devices` | session | iOS APNs device token を登録 |
| `WSS  /v1/agents/<pid>?key=<agent_key>` | agent key | Mac → Relay |
| `WSS  /v1/clients/<pid>?token=<user_token>` | user token | iPhone → Relay |
| `POST /v1/subscriptions/verify` | session | App Store IAP receipt 検証 |

## メッセージプロトコル

WS のメッセージは既存 daemon の `WsServerMessage` / `WsClientMessage` をそのまま転送する
(snapshot / pending / resolved / decide)。Relay は中身を見ず、pairing-id だけ
見て fan-out する。

ただし新しい server→client メッセージ:
- `{ type: "agent-status", online: boolean }` Mac が落ちたかを iPhone に伝える

## 開発

```bash
pnpm --filter @sentinel/relay dev   # tsc --watch
pnpm --filter @sentinel/relay start # 起動
```

## デプロイ (予定)

systemd + Caddy で TLS 終端する一般的な Node サーバ運用。

```
/etc/systemd/system/sentinel-relay.service
Caddyfile: relay.sentinel.app { reverse_proxy localhost:3030 }
```

## 状態

Phase 14-A 着手中。今は骨格のみ。
