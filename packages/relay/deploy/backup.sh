#!/usr/bin/env bash
#
# Vigili Relay SQLite バックアップ。
#
# 実行ユーザ: vigili (systemd service として走る前提)。
# 動作: sqlite3 の .backup を使った hot copy を /var/lib/vigili/backups/ に作り、
#       30 日以上経過したものを削除する。
#
# 単発で動作確認したいときは:
#   sudo -u vigili /opt/vigili/packages/relay/deploy/backup.sh
#
# cron / timer 設定は同ディレクトリの vigili-relay-backup.{service,timer} 参照。

set -euo pipefail

DB="${VIGILI_RELAY_DB:-/var/lib/vigili/relay.db}"
DEST_DIR="${VIGILI_RELAY_BACKUP_DIR:-/var/lib/vigili/backups}"
RETENTION_DAYS="${VIGILI_RELAY_BACKUP_RETENTION_DAYS:-30}"

if [[ ! -f "$DB" ]]; then
  echo "backup: source DB not found: $DB" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$DEST_DIR/relay-$stamp.db"

# .backup は WAL を含めて consistent snapshot を作る。
sqlite3 "$DB" ".backup '$out'"

# 念のため: 直ぐに gzip して領域を節約する (10〜30 倍程度に縮む)。
gzip -f "$out"

# Retention: 指定日数より古いバックアップを削除。
find "$DEST_DIR" -maxdepth 1 -type f -name 'relay-*.db.gz' \
  -mtime "+$RETENTION_DAYS" -delete

# 最後にディレクトリの中身をログ。journalctl から読めるよう短く。
ls -1tr "$DEST_DIR" | tail -5
