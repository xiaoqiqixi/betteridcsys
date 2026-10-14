#!/usr/bin/env bash
# Run on the authorized server only. Produces a sensitive, UNENCRYPTED SQL archive.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p backups
chmod 700 backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
tmp="$(mktemp "backups/aster-${stamp}-XXXXXX.sql.gz.partial")"
file="${tmp%.partial}"
trap 'rm -f "$tmp"' EXIT
docker compose --env-file .env -f compose.yml exec -T db sh -c \
  'export MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"; exec mysqldump --user=root --single-transaction --quick --routines --events --triggers --no-tablespaces --set-gtid-purged=OFF aster' | gzip -c > "$tmp"
gzip -t "$tmp"
mv "$tmp" "$file"
sha256sum "$file" > "${file}.sha256"
echo "Created $file and checksum. Encrypt and copy off-host; creation is not a restore test."
