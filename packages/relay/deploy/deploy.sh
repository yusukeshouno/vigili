#!/usr/bin/env bash
# Vigili Relay デプロイスクリプト。
#
# 前提:
#   - リモートに vigili ユーザ、/opt/vigili、/var/lib/vigili 作成済み
#   - リモートに Node 22 と pnpm 入っている
#   - 初期セットアップ手順は DEPLOY.md 参照
#
# 使い方:
#   VIGILI_RELAY_HOST=debian@153.126.136.207 \
#   VIGILI_RELAY_SSH_KEY=~/.ssh/id_ed25519 \
#   ./packages/relay/deploy/deploy.sh
#
# 流れ:
#   1. local で typecheck → test → build
#   2. rsync で source + dist + package.json + pnpm-lock.yaml を転送
#   3. リモートで pnpm install --prod --frozen-lockfile (relay + shared 限定)
#   4. systemctl restart vigili-relay
#   5. /healthz を叩いて確認

set -euo pipefail

HOST="${VIGILI_RELAY_HOST:-}"
SSH_KEY="${VIGILI_RELAY_SSH_KEY:-$HOME/.ssh/id_ed25519}"
REMOTE_DIR="${VIGILI_RELAY_REMOTE_DIR:-/opt/vigili}"
SERVICE="${VIGILI_RELAY_SERVICE:-vigili-relay}"

if [[ -z "$HOST" ]]; then
  echo "ERROR: VIGILI_RELAY_HOST is required (e.g. debian@153.126.136.207)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

echo "==> typecheck + test"
pnpm --filter @vigili/relay typecheck
pnpm --filter @vigili/relay test

echo "==> build"
pnpm --filter @vigili/shared build
pnpm --filter @vigili/relay build

SSH="ssh -i $SSH_KEY -o IdentitiesOnly=yes $HOST"
RSYNC="rsync -az --delete -e 'ssh -i $SSH_KEY -o IdentitiesOnly=yes'"

echo "==> rsync"
# pnpm workspaces で必要なのは relay と shared と root manifests のみ
eval "$RSYNC \
  --exclude node_modules \
  --exclude '*.log' \
  --include='package.json' \
  --include='pnpm-lock.yaml' \
  --include='pnpm-workspace.yaml' \
  --include='tsconfig.base.json' \
  --include='packages/' \
  --include='packages/shared/' \
  --include='packages/shared/**' \
  --include='packages/relay/' \
  --include='packages/relay/**' \
  --exclude='*' \
  ./ $HOST:$REMOTE_DIR/"

echo "==> install + restart on remote"
$SSH bash -se <<EOF
set -euo pipefail
cd $REMOTE_DIR

# pnpm が無ければ corepack で有効化
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable
  corepack prepare pnpm@10 --activate
fi

# production 依存だけ入れる (devDeps は build を local でやったので不要)
pnpm install --prod --frozen-lockfile \
  --filter @vigili/relay... \
  --ignore-scripts=false

sudo systemctl daemon-reload || true
sudo systemctl restart $SERVICE
sleep 1
sudo systemctl --no-pager status $SERVICE | head -20
EOF

echo "==> healthcheck"
# nginx 経由ではなく直接 loopback 経由でも叩けるよう localhost で
$SSH "curl -fsS http://127.0.0.1:3030/healthz && echo"

echo "==> done"
