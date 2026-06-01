# Vigili Relay — VPS デプロイ手順

対象: Debian 12 (bookworm) 想定の VPS。nginx + Let's Encrypt + systemd で運用。

サーバ側で root 権限 (もしくは sudo) があり、外部から FQDN が 80/443 で見える前提。

---

## 0. 事前準備 (1 回だけ)

### 0-1. DNS

公開したい FQDN (例: `relay.vigili.io`) の A レコードを VPS の IP に向ける。
反映確認:

```bash
dig +short relay.vigili.io
# → 153.126.136.207
```

### 0-2. リモートに必要な OS パッケージ

VPS で:

```bash
sudo apt update
sudo apt install -y curl ca-certificates build-essential python3 git \
  nginx certbot python3-certbot-nginx ufw rsync
```

### 0-3. Node 22 のインストール

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
node -v   # v22.x
sudo corepack enable
sudo corepack prepare pnpm@10 --activate
pnpm -v
```

### 0-4. 専用ユーザと配置先

```bash
sudo useradd --system --create-home --home-dir /var/lib/vigili \
  --shell /usr/sbin/nologin vigili
sudo mkdir -p /opt/vigili
sudo chown vigili:vigili /opt/vigili /var/lib/vigili
# deploy.sh は debian ユーザで rsync するため、書き込み許可を付与
sudo setfacl -R -m u:debian:rwx /opt/vigili   # acl 入っていれば
# あるいは: sudo chown debian:vigili /opt/vigili && sudo chmod 775 /opt/vigili
```

### 0-5. systemd unit

```bash
sudo cp packages/relay/deploy/vigili-relay.service \
  /etc/systemd/system/vigili-relay.service
sudo systemctl daemon-reload
# まだ enable しない (バイナリ未配置のため)
```

### 0-6. nginx + Let's Encrypt

```bash
sudo cp packages/relay/deploy/nginx-relay.conf \
  /etc/nginx/sites-available/vigili-relay
sudo sed -i 's|__RELAY_FQDN__|relay.vigili.io|g' \
  /etc/nginx/sites-available/vigili-relay
sudo ln -sf /etc/nginx/sites-available/vigili-relay \
  /etc/nginx/sites-enabled/vigili-relay
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d relay.vigili.io
# certbot が server ブロックに ssl_certificate を埋め込む
sudo systemctl reload nginx
```

### 0-7. ファイアウォール

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
sudo ufw status
# relay は 3030 を 127.0.0.1 にバインドしているので 3030 は外に出ない
```

### 0-8. deploy ユーザの sudo

`deploy.sh` の中で `sudo systemctl restart vigili-relay` を打つので、
パスワード無しで限定的に許可する:

```bash
sudo visudo -f /etc/sudoers.d/vigili-relay
# 中身:
# debian ALL=(root) NOPASSWD: /bin/systemctl restart vigili-relay, \
#                            /bin/systemctl status vigili-relay, \
#                            /bin/systemctl daemon-reload
```

---

## 1. 初回デプロイ

ローカルで:

```bash
VIGILI_RELAY_HOST=debian@153.126.136.207 \
VIGILI_RELAY_SSH_KEY=~/.ssh/id_ed25519 \
./packages/relay/deploy/deploy.sh
```

deploy.sh は以下を実行:

1. local で `pnpm --filter @vigili/relay typecheck && test && build`
2. rsync で source + dist + manifests を `/opt/vigili/` に転送
3. リモートで `pnpm install --prod --frozen-lockfile --filter @vigili/relay...`
4. `sudo systemctl restart vigili-relay`
5. `curl http://127.0.0.1:3030/healthz` で確認

初回は事前に enable しておく:

```bash
ssh debian@153.126.136.207 sudo systemctl enable --now vigili-relay
```

---

## 2. 動作確認 (外部から)

```bash
curl https://relay.vigili.io/healthz
# → {"ok":true,"version":1}

# signup
curl -s https://relay.vigili.io/v1/signup \
  -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"password1234"}' | jq .

# WSS は websocat で
websocat "wss://relay.vigili.io/v1/agents/<PID>?token=<AGENT_KEY>"
```

---

## 3. 監視 / 運用

- ログ: `sudo journalctl -u vigili-relay -f`
- DB の場所: `/var/lib/vigili/relay.db`
- nginx access log: `/var/log/nginx/access.log`

### 3-1. SQLite 日次バックアップ (systemd timer)

`backup.sh` が `sqlite3 .backup` でホットスナップショットを取って
`/var/lib/vigili/backups/relay-YYYYMMDDTHHMMSSZ.db.gz` に置く。30 日以上経過
した古いものは自動削除。

初回セットアップ:

```bash
sudo cp /opt/vigili/packages/relay/deploy/vigili-relay-backup.service \
        /etc/systemd/system/vigili-relay-backup.service
sudo cp /opt/vigili/packages/relay/deploy/vigili-relay-backup.timer \
        /etc/systemd/system/vigili-relay-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now vigili-relay-backup.timer

# 動作確認 (timer を待たずに今すぐ走らせる)
sudo systemctl start vigili-relay-backup.service
sudo ls -la /var/lib/vigili/backups/
```

タイマーの状態確認:

```bash
sudo systemctl list-timers vigili-relay-backup.timer
sudo journalctl -u vigili-relay-backup.service -n 20
```

### 3-2. 死活監視 (cron + ntfy)

外部 uptime monitoring (UptimeRobot / Better Stack 等) に
`https://relay.vigili.io/healthz` を 5 分間隔で登録するのが基本。

VPS 内でも回したい場合は `healthcheck.sh` を cron に入れる:

```bash
# crontab -e (任意のユーザ)
*/5 * * * * VIGILI_RELAY_NTFY_URL=https://ntfy.sh/<自分のトピック> \
  /opt/vigili/packages/relay/deploy/healthcheck.sh
```

`VIGILI_RELAY_NTFY_URL` を設定しておけば落ちた瞬間に push が飛ぶ。
URL を省略すれば標準エラーに出すだけ。

---

## 4. 撤去

```bash
sudo systemctl disable --now vigili-relay
sudo rm /etc/systemd/system/vigili-relay.service
sudo systemctl daemon-reload
sudo rm /etc/nginx/sites-enabled/vigili-relay
sudo rm /etc/nginx/sites-available/vigili-relay
sudo systemctl reload nginx
sudo certbot delete --cert-name relay.vigili.io   # 任意
sudo rm -rf /opt/vigili /var/lib/vigili
sudo userdel vigili
```

---

## 5. APNs Push 設定 (LAN 外 wake の有効化)

relay は pairing ごとに iOS device token を保持し、Mac daemon から `pending` /
`question` (AskUserQuestion) / `plan` (ExitPlanMode) が来た瞬間に APNs push して
バックグラウンドのスマホを起こす。これが LAN 外で承認 / 質問 / plan に気づく唯一の経路
(iOS は WS をバックグラウンドでサスペンドするため)。

APNs env が 1 つでも欠けると relay は `[apns] 未設定 … push 無効` で起動する
(WS fan-out は動くが push は飛ばない)。

### 5-1. Apple Developer で APNs Auth Key を作る

1. <https://developer.apple.com/account> → Certificates, IDs & Profiles → **Keys** → ＋
2. 「Apple Push Notifications service (APNs)」にチェック → Continue → Register
3. `AuthKey_XXXXXXXXXX.p8` を **ダウンロード (1 回きり。再DLは不可、無くしたら作り直し)**。
   表示される **Key ID** (10 文字) を控える
4. 既に分かっている値:
   - **Team ID** = `2DG598WNT9`
   - **Topic** = iOS アプリの bundle id = `io.vigili.mobile.shono`
   - **Env** = `sandbox` (アプリ entitlement が `aps-environment: development` のため。
     TestFlight / App Store 配布に切り替えたら `production`)

### 5-2. VPS に秘密を設置 (.p8 は repo に置かない)

```bash
# 1) .p8 を vigili が読める場所へ (ReadWritePaths=/var/lib/vigili の配下)
sudo mkdir -p /var/lib/vigili/apns
sudo cp AuthKey_XXXXXXXXXX.p8 /var/lib/vigili/apns/
sudo chown -R vigili:vigili /var/lib/vigili/apns
sudo chmod 600 /var/lib/vigili/apns/AuthKey_XXXXXXXXXX.p8

# 2) env ファイル (systemd EnvironmentFile 用、root 所有 / vigili 読取)
sudo mkdir -p /etc/vigili
sudo tee /etc/vigili/relay.env >/dev/null <<'EOF'
APNS_KEY_PATH=/var/lib/vigili/apns/AuthKey_XXXXXXXXXX.p8
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=2DG598WNT9
APNS_TOPIC=io.vigili.mobile.shono
APNS_ENV=sandbox
# Sign in with Apple の identity token 検証で許可する audience(bundle id)。
# 省略可 (既定が下記)。Apple の公開 JWKS で検証するので秘密鍵は不要。
APPLE_AUD=io.vigili.app.shono,io.vigili.mobile.shono
EOF
sudo chown root:vigili /etc/vigili/relay.env
sudo chmod 640 /etc/vigili/relay.env
```

### 5-3. unit に EnvironmentFile を追加

`/etc/systemd/system/vigili-relay.service` の `[Service]` セクションに 1 行足す:

```ini
EnvironmentFile=/etc/vigili/relay.env
```

反映 (sudoers で NOPASSWD 許可済みのコマンド):

```bash
sudo systemctl daemon-reload
sudo systemctl restart vigili-relay
sudo systemctl --no-pager status vigili-relay | head -20
```

### 5-4. 確認

status の起動ログが次のようになっていれば有効化成功 (`未設定` が消える):

```
[apns] enabled env=sandbox topic=io.vigili.mobile.shono keyId=XXXXXXXXXX
```

あとは iOS アプリがペアリング済みなら、LAN 外 (Wi-Fi を切る等) で Mac セッションが
pending / question / plan を出すとロック画面に通知が届く。届かない場合:

- アプリで APNs 登録が済んでいるか (`POST /v1/clients/:pid/devices` が 201 で通ったか)。
- `APNS_ENV` がビルド種別と一致しているか (development build なら `sandbox`)。production に
  すると `BadDeviceToken` で弾かれる (逆も同様)。
- `Topic` が iOS アプリの bundle id と一致しているか。

---

## 6. ハマりどころ

- **better-sqlite3 が pnpm install で失敗する**
  → リモートに `build-essential` と `python3` が必要 (上記 0-2)。Node のバージョンが
  ローカルと違うと prebuild が当たらず source build される。
- **nginx が 502 を返す**
  → relay が落ちている。`sudo journalctl -u vigili-relay -n 50` で原因を見る。
- **WSS の接続がすぐ切れる**
  → `proxy_read_timeout` が短すぎる。本 conf では 3600s。Cloudflare 等のプロキシを
  挟む場合はそちらの idle timeout も確認。
- **certbot --nginx が "no matching server block"**
  → `server_name __RELAY_FQDN__` の置換漏れ。`grep RELAY_FQDN /etc/nginx/sites-enabled/vigili-relay`
  で確認。
- **fail2ban で自分が締め出される**
  → 何度も SSH 失敗すると `/etc/fail2ban/jail.local` の bantime ぶん閉まる。
  ローカルから `fail2ban-client status sshd` の閲覧は VPS コンソールで。
