#!/usr/bin/env bash
#
# Vigili Relay 死活確認スクリプト。
#
# /healthz が 200 + {"ok":true} なら exit 0、それ以外は exit 1。
# 外部 uptime monitoring (UptimeRobot 等) から走らせるか、
# VPS 上の cron で 5 分ごとに動かして異常時に通知する。
#
# 環境変数:
#   VIGILI_RELAY_URL          (default: https://relay.vigili.io/healthz)
#   VIGILI_RELAY_TIMEOUT      (default: 10s)
#   VIGILI_RELAY_NTFY_URL     ntfy.sh の通知 URL (省略可。設定時は失敗で push)
#
# 例 (cron):
#   */5 * * * * VIGILI_RELAY_NTFY_URL=https://ntfy.sh/vigili-ops \
#                /opt/vigili/packages/relay/deploy/healthcheck.sh

set -euo pipefail

URL="${VIGILI_RELAY_URL:-https://relay.vigili.io/healthz}"
TIMEOUT="${VIGILI_RELAY_TIMEOUT:-10}"
NTFY="${VIGILI_RELAY_NTFY_URL:-}"

notify_fail() {
  local detail="$1"
  if [[ -n "$NTFY" ]]; then
    curl -fsS -m 10 -H 'Priority: high' -H 'Tags: warning,vigili' \
      -d "Vigili relay DOWN: $detail" "$NTFY" >/dev/null || true
  fi
  echo "FAIL: $detail" >&2
}

resp="$(curl -fsS -m "$TIMEOUT" "$URL" 2>&1)" || {
  notify_fail "curl failed: $resp"
  exit 1
}

if ! echo "$resp" | grep -q '"ok":true'; then
  notify_fail "unexpected body: $resp"
  exit 1
fi

echo "ok"
