#!/usr/bin/env bash
# Local regression test with a fake Docker executable, never a database backup.
set -euo pipefail
script_dir=$(cd "$(dirname "$0")" && pwd -P)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/aster-backup-test.XXXXXXXX")
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/deploy/scripts" "$tmp/bin" "$tmp/copied"
cp "$script_dir/backup.sh" "$tmp/deploy/scripts/backup.sh"
cat > "$tmp/bin/docker" <<'EOF'
#!/usr/bin/env bash
if [[ "${MOCK_BACKUP_FAIL:-0}" == 1 ]]; then
  printf 'partial SQL\n'
  exit 42
fi
printf '%s\n' '-- mock backup, contains no database data' 'SELECT 1;'
EOF
cat > "$tmp/bin/date" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '20261014T000000Z'
EOF
chmod +x "$tmp/bin/docker" "$tmp/bin/date"
export PATH="$tmp/bin:$PATH"
jobs=()
for _ in 1 2 3 4 5 6 7 8; do
  bash "$tmp/deploy/scripts/backup.sh" >/dev/null &
  jobs+=("$!")
done
for pid in "${jobs[@]}"; do wait "$pid"; done
count=$(find "$tmp/deploy/backups" -name '*.sql.gz' -type f | wc -l)
[[ "$count" == 8 ]] || { echo 'FAIL: concurrent backup count' >&2; exit 1; }
cp "$tmp/deploy/backups/"* "$tmp/copied/"
(
  cd "$tmp/copied"
  for checksum in *.sha256; do sha256sum -c "$checksum" >/dev/null; done
  for archive in *.sql.gz; do gzip -t "$archive"; done
)
if MOCK_BACKUP_FAIL=1 bash "$tmp/deploy/scripts/backup.sh" >/dev/null 2>&1; then
  echo 'FAIL: failing dump reported success' >&2; exit 1
fi
[[ -z "$(find "$tmp/deploy/backups" -name '*.partial' -print -quit)" ]] || { echo 'FAIL: partial archive left behind' >&2; exit 1; }
[[ "$(find "$tmp/deploy/backups" -name '*.sql.gz' -type f | wc -l)" == 8 ]] || { echo 'FAIL: failed dump published' >&2; exit 1; }
[[ "$(stat -c %a "$tmp/deploy/backups")" == 700 ]] || { echo 'FAIL: backup directory permissions' >&2; exit 1; }
[[ -z "$(find "$tmp/deploy/backups" -type f ! -perm 600 -print -quit)" ]] || { echo 'FAIL: backup file permissions' >&2; exit 1; }
echo 'PASS: 8 same-second backups, portable checksums, gzip validation, failure cleanup, private permissions (mock Docker only)'
