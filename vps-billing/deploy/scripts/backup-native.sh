#!/usr/bin/env bash
# Linux / MySQL 8.4 native, same-host backup. No service or database mutations.
# Output is sensitive and UNENCRYPTED; see docs/BACKUP_RECOVERY.md.
set -euo pipefail
umask 077
export LC_ALL=C

fail() { printf 'Backup failed: %s\n' "$1" >&2; exit 1; }
usage() {
  printf '%s\n' 'Usage: backup-native.sh --client-config /private/client.cnf --socket /run/mysqld/mysqld.sock --database NAME --output-dir /private/backups'
}
client_config='' db_socket='' database='' output_dir=''
declare -A arguments=()
while (($#)); do
  case "$1" in
    --help) usage; exit 0 ;;
    --client-config|--socket|--database|--output-dir)
      (($# >= 2)) || fail 'Missing argument value.'
      [[ ! ${arguments[$1]+set} ]] || fail 'Repeated argument.'
      arguments[$1]=1
      case "$1" in
        --client-config) client_config=$2 ;;
        --socket) db_socket=$2 ;;
        --database) database=$2 ;;
        --output-dir) output_dir=$2 ;;
      esac
      shift 2 ;;
    *) usage >&2; fail 'Unsupported argument.' ;;
  esac
done
[[ -n "$client_config" && -n "$db_socket" && -n "$database" && -n "$output_dir" ]] || { usage >&2; fail 'All four arguments are required.'; }
[[ "$database" =~ ^[A-Za-z_][A-Za-z0-9_]{0,63}$ ]] || fail 'Database name must be a 1-64 character ASCII identifier beginning with a letter or underscore.'
case "${database,,}" in mysql|sys|information_schema|performance_schema) fail 'System databases are not supported.' ;; esac
for path in "$client_config" "$db_socket" "$output_dir"; do
  [[ "$path" == /* && ! "$path" =~ [[:cntrl:]] ]] || fail 'Use absolute paths without control characters.'
done
for command in mysql mysqldump gzip sha256sum mktemp stat realpath mv date; do
  command -v "$command" >/dev/null 2>&1 || fail 'A required tool is unavailable (Bash, GNU coreutils, gzip, MySQL 8.4 mysql/mysqldump).'
done
[[ -f "$client_config" && ! -L "$client_config" && -r "$client_config" ]] || fail 'Client config must be a readable regular file, not a symlink.'
[[ $(stat -c %u -- "$client_config") == "$EUID" ]] || fail 'Client config must belong to the account running this script.'
case "$(stat -c %a -- "$client_config")" in 400|600) ;; *) fail 'Client config permissions must be 0400 or 0600.' ;; esac
[[ $(stat -c %h -- "$client_config") == 1 ]] || fail 'Client config must not have additional hard links.'
while [[ "$output_dir" != / && "$output_dir" == */ ]]; do output_dir=${output_dir%/}; done
[[ -d "$output_dir" && ! -L "$output_dir" ]] || fail 'Output directory must already exist and must not be a symlink.'
[[ $(stat -c %u -- "$output_dir") == "$EUID" && $(stat -c %a -- "$output_dir") == 700 ]] || fail 'Output directory must belong to this account and have mode 0700.'
[[ -w "$output_dir" && -x "$output_dir" ]] || fail 'Output directory is not writable.'
client_config=$(realpath -e -- "$client_config")
output_dir=$(realpath -e -- "$output_dir")
# Check all canonical ancestors, not only the immediate parent. A writable
# grandparent can otherwise rename an apparently private child. Root-owned
# sticky directories (notably /tmp) are safe only because the protected child
# was already checked while walking from the inside out.
check_directory_chain() {
  local directory=$1 owner mode
  [[ -n "$directory" ]] || directory=/
  while :; do
    owner=$(stat -c %u -- "$directory")
    mode=$(stat -c %a -- "$directory")
    [[ "$owner" == "$EUID" || "$owner" == 0 ]] || fail 'Credential/output directory ancestors must belong to this account or root.'
    if (( (8#$mode & 0022) != 0 )); then
      [[ "$owner" == 0 ]] && (( (8#$mode & 01000) != 0 )) || fail 'Credential/output directory ancestors must not be group/world writable (except root-owned sticky directories).'
    fi
    [[ "$directory" != / ]] || break
    directory=${directory%/*}
    [[ -n "$directory" ]] || directory=/
  done
}
check_directory_chain "${client_config%/*}"
check_directory_chain "$output_dir"
# Recheck canonical endpoints so a redirected original path cannot bypass the
# ownership/permissions checks above. This is not isolation from the same UID.
[[ -f "$client_config" && $(stat -c %u -- "$client_config") == "$EUID" && $(stat -c %h -- "$client_config") == 1 ]] || fail 'Canonical client config does not meet ownership or regular-file requirements.'
case "$(stat -c %a -- "$client_config")" in 400|600) ;; *) fail 'Canonical client config must remain private.' ;; esac
[[ $(stat -c %u -- "$output_dir") == "$EUID" && $(stat -c %a -- "$output_dir") == 700 ]] || fail 'Canonical output directory must remain private.'

# Do not source this file or print values. Only credentials are accepted; extra
# MySQL options could silently omit tables, change targets, run SQL or hide errors.
seen_group=0
declare -A options=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*[#\;] ]] && continue
  if [[ "$line" =~ ^[[:space:]]*\[client\][[:space:]]*$ ]]; then
    ((seen_group == 0)) || fail 'Client config must contain exactly one [client] group.'
    seen_group=1
  elif [[ "$line" =~ ^[[:space:]]*(user|password)[[:space:]]*=[[:space:]]*(.+)$ ]]; then
    ((seen_group == 1)) || fail 'Credentials must be inside [client].'
    option=${BASH_REMATCH[1]}
    if [[ "$option" == user ]]; then
      [[ ${BASH_REMATCH[2]} =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,31}[[:space:]]*$ ]] || fail 'Use an explicit unquoted 1-32 character backup account name.'
    fi
    [[ ! ${options[$option]+set} ]] || fail 'Repeated client config option.'
    options[$option]=1
  else
    fail 'Client config permits only [client], user/password assignments and comments; includes and all other options are rejected.'
  fi
done < "$client_config"
[[ ${options[user]+set} ]] || fail 'Client config requires an explicit user.'
unset line

stamp=$(date -u +%Y%m%dT%H%M%SZ)
[[ "$stamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail 'Could not obtain a UTC timestamp.'
staging=$(mktemp -d "$output_dir/.aster-$database-$stamp-XXXXXXXX.partial")
cleanup() { [[ -z "$staging" ]] || rm -rf -- "$staging"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
name=${staging##*/}
final="$output_dir/${name#.}"
final=${final%.partial}

# --defaults-file must be first. Explicit socket transport and disabling login
# paths prevent unrelated personal settings from selecting another server.
# Only the current project schema (InnoDB base tables) is supported. Refuse
# custom objects instead of omitting them silently or exporting qualified SQL
# and DROP statements. The backup role must have the metadata visibility
# documented in BACKUP_RECOVERY.md, including SHOW_ROUTINE.
schema_query="SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND (TABLE_TYPE <> 'BASE TABLE' OR COALESCE(ENGINE, '') <> 'InnoDB')) +
  (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()) +
  (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE()) +
  (SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE());"
if ! unsupported=$(
  unset MYSQL_PWD MYSQL_HOST MYSQL_TCP_PORT MYSQL_UNIX_PORT MYSQL_GROUP_SUFFIX MYSQL_TEST_LOGIN_FILE
  mysql --defaults-file="$client_config" --no-login-paths \
    --protocol=SOCKET --socket="$db_socket" --batch --skip-column-names \
    --execute="$schema_query" "$database" 2>"$staging/schema.stderr"
); then
  fail 'Schema preflight failed. Check the approved private client diagnostics and backup account metadata privileges.'
fi
[[ "$unsupported" == 0 ]] || fail 'Only InnoDB base tables are supported. Unexpected metadata or custom database objects require a separately reviewed backup procedure.'
# No --databases: no generated CREATE DATABASE or USE source-database clause.
if ! (
  unset MYSQL_PWD MYSQL_HOST MYSQL_TCP_PORT MYSQL_UNIX_PORT MYSQL_GROUP_SUFFIX MYSQL_TEST_LOGIN_FILE
  mysqldump --defaults-file="$client_config" --no-login-paths \
    --protocol=SOCKET --socket="$db_socket" \
    --single-transaction --quick --skip-routines --skip-events --skip-triggers \
    --no-tablespaces --set-gtid-purged=OFF --hex-blob \
    --default-character-set=utf8mb4 --skip-add-drop-table --skip-add-locks \
    "$database" 2>"$staging/dump.stderr"
) | gzip -n -c > "$staging/database.sql.gz" 2>"$staging/gzip.stderr"; then
  # Never echo server/config diagnostics or a partially successful SQL dump.
  fail 'Dump or compression failed. No completed backup was published; check the approved database/client diagnostics privately.'
fi
[[ -s "$staging/database.sql.gz" ]] || fail 'The archive is empty.'
if ! gzip -t "$staging/database.sql.gz" 2>"$staging/gzip.stderr"; then
  fail 'Compressed archive validation failed. No completed backup was published.'
fi
# Preserve a non-sensitive warning indicator rather than possibly secret stderr.
warning=no
[[ ! -s "$staging/dump.stderr" ]] || warning=yes
rm -- "$staging/dump.stderr" "$staging/gzip.stderr" "$staging/schema.stderr"
printf 'format=aster-native-logical-v1\ncreated_utc=%s\ndatabase=%s\ntransport=local-unix-socket\ndump_warnings=%s\nencrypted=no\n' "$stamp" "$database" "$warning" > "$staging/BACKUP.txt"
(cd "$staging" && sha256sum database.sql.gz BACKUP.txt > SHA256SUMS)
(cd "$staging" && sha256sum --check --status SHA256SUMS) || fail 'Checksum verification failed.'
# Publish the complete pair as one directory on the same filesystem. GNU mv -n
# may report success on collision, so also prove that the staging name vanished.
mv --no-clobber --no-target-directory -- "$staging" "$final"
[[ ! -e "$staging" ]] || fail 'Destination already exists; existing backup was not overwritten.'
staging=''
printf 'Created %s (unencrypted). Verify, encrypt and copy off-host; this is not a restore test.\n' "$final"
[[ "$warning" == no ]] || printf '%s\n' 'mysqldump emitted warnings. Review the approved private diagnostics before accepting this recovery point.' >&2
