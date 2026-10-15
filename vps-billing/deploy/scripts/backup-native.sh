#!/usr/bin/env bash
# Linux / MySQL 8.4 native, same-host backup. No service or database mutations.
# Output is sensitive and UNENCRYPTED; see docs/BACKUP_RECOVERY.md.
set -euo pipefail
umask 077
export LC_ALL=C

fail() { printf 'Backup failed: %s\n' "$1" >&2; exit 1; }
usage() {
  printf '%s\n' 'Usage: backup-native.sh --client-config /private/client.cnf --socket /run/mysqld/mysqld.sock --database NAME --output-dir /private/backups --release-directory /verified/assembled-release'
  printf '%s\n' 'Independently verify the assembled release first; prevent migrations and all other DDL throughout the backup window.'
}
client_config='' db_socket='' database='' output_dir='' release_directory=''
declare -A arguments=()
while (($#)); do
  case "$1" in
    --help) usage; exit 0 ;;
    --client-config|--socket|--database|--output-dir|--release-directory)
      (($# >= 2)) || fail 'Missing argument value.'
      [[ ! ${arguments[$1]+set} ]] || fail 'Repeated argument.'
      arguments[$1]=1
      case "$1" in
        --client-config) client_config=$2 ;;
        --socket) db_socket=$2 ;;
        --database) database=$2 ;;
        --output-dir) output_dir=$2 ;;
        --release-directory) release_directory=$2 ;;
      esac
      shift 2 ;;
    *) usage >&2; fail 'Unsupported argument.' ;;
  esac
done
[[ -n "$client_config" && -n "$db_socket" && -n "$database" && -n "$output_dir" && -n "$release_directory" ]] || { usage >&2; fail 'All five arguments are required.'; }
[[ "$database" =~ ^[A-Za-z_][A-Za-z0-9_]{0,63}$ ]] || fail 'Database name must be a 1-64 character ASCII identifier beginning with a letter or underscore.'
case "${database,,}" in mysql|sys|information_schema|performance_schema) fail 'System databases are not supported.' ;; esac
for path in "$client_config" "$db_socket" "$output_dir" "$release_directory"; do
  [[ "$path" == /* && ! "$path" =~ [[:cntrl:]] ]] || fail 'Use absolute paths without control characters.'
done
for command in mysql mysqldump gzip sha256sum mktemp stat realpath mv date cmp python3; do
  command -v "$command" >/dev/null 2>&1 || fail 'A required tool is unavailable (Bash, GNU coreutils, Python 3, gzip, MySQL 8.4 mysql/mysqldump).'
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
[[ -d "$release_directory" ]] || fail 'Release directory must already exist.'
release_directory=$(realpath -e -- "$release_directory")
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

# The operator supplies an ALREADY independently verified assembled release.
# BUILD/source_files bind its local layout, not its publisher authenticity:
# current BUILD schemas do not carry migration hashes or source blob records.
# Re-read the local manifest/SQL at each observation to reject a changed input.
metadata() {
  python3 - "$release_directory" "$database" "$@" <<'PY'
import hashlib
import json
from pathlib import Path
import re
import sys

class Rejected(Exception):
    pass

def require(ok, message):
    if not ok:
        raise Rejected(message)

def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, "Duplicate release metadata keys are unsupported.")
        result[key] = value
    return result

def read(path, limit=1 << 20):
    require(path.is_file() and not path.is_symlink() and 0 < path.stat().st_size <= limit,
            "Release and schema metadata must be bounded regular files without symlinks.")
    raw = path.read_bytes()
    require(0 < len(raw) <= limit, "Release or schema metadata exceeds its size bound.")
    return raw

def definitions(raw):
    # Only the shipped migration grammar is supported. Do not execute SQL or
    # mistake commas inside type/constraint expressions for column boundaries.
    result, start, depth, quoted = [], 0, 0, False
    for index, char in enumerate(raw):
        if char == "'":
            quoted = not quoted
        elif not quoted:
            depth += (char == "(") - (char == ")")
            require(depth >= 0, "Unsupported migration definition.")
            if char == "," and depth == 0:
                result.append(raw[start:index].strip())
                start = index + 1
    require(not quoted and depth == 0, "Unsupported migration definition.")
    return result + [raw[start:].strip()]

def extend_shape(shape, sql):
    for statement in sql.split(";"):
        statement = statement.strip()
        if not statement:
            continue
        create = re.fullmatch(r"CREATE TABLE IF NOT EXISTS ([a-z_][a-z0-9_]*)\s*\((.*)\)\s*ENGINE=InnoDB", statement, re.S)
        add = re.fullmatch(r"ALTER TABLE ([a-z_][a-z0-9_]*) ADD COLUMN ([a-z_][a-z0-9_]*)\s+.+", statement, re.S)
        other = re.fullmatch(r"ALTER TABLE ([a-z_][a-z0-9_]*) (?:ADD CONSTRAINT [a-z_][a-z0-9_]* CHECK\s*\(.+\)|DROP CHECK [a-z_][a-z0-9_]*)", statement, re.S)
        insert = re.match(r"INSERT IGNORE INTO ([a-z_][a-z0-9_]*)\s*\(", statement)
        if create:
            table, body = create.groups()
            require(table not in shape, "Duplicate migration table definition.")
            columns = []
            for definition in definitions(body):
                if re.match(r"(?:PRIMARY|FOREIGN|KEY|UNIQUE|CHECK|CONSTRAINT)\b", definition):
                    continue
                column = re.fullmatch(r"([a-z_][a-z0-9_]*)\s+.+", definition, re.S)
                require(column is not None and column[1] not in columns, "Unsupported migration column definition.")
                columns.append(column[1])
            require(columns, "Empty migration table definition.")
            shape[table] = columns
        elif add:
            table, column = add.groups()
            require(table in shape and column not in shape[table], "Unknown or repeated migration column.")
            shape[table].append(column)
        elif other or insert:
            require((other or insert)[1] in shape, "Unknown migration table.")
        else:
            raise Rejected("Migration grammar needs a separately reviewed backup procedure.")

def release(root):
    require(not (root / "manifests").is_symlink() and not (root / "migrations").is_symlink(), "Release metadata directories must not be symlinks.")
    build_raw = read(root / "manifests/BUILD.json")
    build = json.loads(build_raw, object_pairs_hook=pairs)
    require(isinstance(build, dict) and type(build.get("schema")) is int and build["schema"] in {2, 3}, "Unsupported release BUILD schema.")
    require((build["schema"] == 3 and build.get("distribution_format") == "raw-binaries-v1") or
            (build["schema"] == 2 and "distribution_format" not in build), "Release distribution format does not match BUILD schema.")
    versions = build.get("component_versions")
    require(build.get("release_kind") == "core" and build.get("target") == "linux/amd64" and build.get("cgo_enabled") is False and
            isinstance(build.get("source_commit"), str) and re.fullmatch(r"[a-f0-9]{40}", build["source_commit"]) and
            isinstance(versions, dict) and isinstance(versions.get("core"), str) and
            re.fullmatch(r"(?:0|[1-9][0-9]{0,5})(?:\.(?:0|[1-9][0-9]{0,5})){2}", versions["core"]) and
            build.get("release_label") == versions["core"], "Release core identity is incomplete or invalid.")
    copies = build.get("source_files")
    require(isinstance(copies, dict) and 1 <= len(copies) <= 512 and all(isinstance(k, str) and isinstance(v, str) for k, v in copies.items()), "Release source file inventory is invalid.")
    paths = sorted((root / "migrations").iterdir())
    require(0 < len(paths) <= 64, "Release requires a nonempty bounded SQL migration inventory.")
    hashes, shapes = {}, {}
    shape = {"schema_migrations": ["version", "checksum", "applied_at"]}
    for number, path in enumerate(paths, 1):
        require(re.fullmatch(r"[0-9]{3}_[a-z0-9_]+\.sql", path.name) and int(path.name[:3]) == number,
                "Release SQL migrations must form an unchanged numbered prefix beginning at 001.")
        destination = "migrations/" + path.name
        source = "vps-billing/backend/" + destination
        require(copies.get(destination) == source, "Release migration source mapping is missing or invalid.")
        raw = read(path)
        checksum = hashlib.sha256(raw).hexdigest()
        # If a BUILD includes this source in its input digest records, require
        # the file to match. Current official manifests map paths only.
        inputs = build.get("input_sha256", {})
        require(isinstance(inputs, dict) and (source not in inputs or inputs[source] == checksum), "Release migration source digest mismatch.")
        extend_shape(shape, raw.decode("utf-8"))
        hashes[str(number)] = checksum
        shapes[str(number)] = {table: list(columns) for table, columns in shape.items()}
    require({key for key in copies if key.startswith("migrations/")} == {"migrations/" + path.name for path in paths}, "Release SQL inventory differs from its source mapping.")
    return {"build_sha256": hashlib.sha256(build_raw).hexdigest(), "source_commit": build["source_commit"],
            "core_version": versions["core"], "migration_checksums": hashes, "shapes": shapes}

def validate(expected, snapshot, database):
    lines = [line.split("\t") for line in read(snapshot).decode("utf-8").splitlines()]
    groups = {}
    for fields in lines:
        require(fields[0] in {"identity", "unsupported", "migration", "table", "column", "constraint", "index", "key", "reference"}, "Malformed database schema metadata.")
        require(len(fields) == {"identity": 5, "unsupported": 2, "migration": 3, "table": 4, "column": 12,
                                "constraint": 6, "index": 11, "key": 9, "reference": 9}[fields[0]], "Malformed database schema metadata.")
        groups.setdefault(fields[0], []).append(fields[1:])
    identity = groups.get("identity", [])
    require(len(identity) == 1 and len(identity[0]) == 4, "Database server identity is missing or malformed.")
    version, vendor, actual_database, server_uuid = identity[0]
    require(re.fullmatch(r"8\.4\.[0-9]+(?:[-+][A-Za-z0-9.+~_-]+)?", version) and
            re.fullmatch(r"MySQL (?:Community|Enterprise) Server(?: - (?:GPL|Commercial|Advanced Edition))?", vendor),
            "Only the reviewed Oracle MySQL 8.4 server family is supported.")
    require(actual_database == database and re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", server_uuid), "Database or server identity does not match the requested target.")
    require(groups.get("unsupported") == [["0"]], "Only InnoDB base tables without custom database objects are supported.")
    history = groups.get("migration", [])
    require(0 < len(history) <= len(expected["migration_checksums"]), "Database migration history must be a nonempty release prefix.")
    migrations = {}
    for number, fields in enumerate(history, 1):
        require(len(fields) == 2 and fields[0] == str(number) and fields[1] == expected["migration_checksums"][str(number)],
                "Database migrations must match an unchanged contiguous release SQL prefix.")
        migrations[str(number)] = fields[1]
    shape = expected["shapes"][str(len(history))]
    require(groups.get("table") == [[name, "BASE TABLE", "InnoDB"] for name in sorted(shape)], "Unknown or partial database table inventory.")
    columns = groups.get("column", [])
    require(all(len(fields) == 11 for fields in columns) and [[fields[0], fields[1]] for fields in columns] ==
            [[table, column] for table in sorted(shape) for column in shape[table]], "Unknown or partial database column inventory.")
    return {"schema": 1, "source_commit": expected["source_commit"], "core_version": expected["core_version"],
            "database": database, "schema_version": len(history), "migration_checksums": migrations}

try:
    root, database, action, prepared, *rest = sys.argv[1:]
    expected = release(Path(root))
    if action == "prepare":
        Path(prepared).write_text(json.dumps(expected, sort_keys=True) + "\n")
    else:
        require(action == "validate" and len(rest) == 2 and json.loads(read(Path(prepared))) == expected, "Release metadata changed during backup.")
        snapshot, output = rest
        metadata = validate(expected, Path(snapshot), database)
        Path(output).write_text(json.dumps(metadata, sort_keys=True, indent=2) + "\n")
except Rejected as error:
    print("Backup failed: " + str(error), file=sys.stderr)
    sys.exit(1)
except (OSError, ValueError, TypeError, KeyError, UnicodeError):
    print("Backup failed: Release or database metadata could not be read or validated.", file=sys.stderr)
    sys.exit(1)
PY
}
metadata prepare "$staging/release.json" || exit 1

# --defaults-file must be first. Explicit socket transport and disabling login
# paths prevent unrelated personal settings from selecting another server.
# Only the current project schema (InnoDB base tables) is supported. Refuse
# custom objects instead of omitting them silently or exporting qualified SQL
# and DROP statements. The backup role must have the metadata visibility
# documented in BACKUP_RECOVERY.md, including SHOW_ROUTINE.
schema_query="SELECT 'identity', VERSION(), @@version_comment, DATABASE(), @@server_uuid;
SELECT 'unsupported',
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND (TABLE_TYPE <> 'BASE TABLE' OR COALESCE(ENGINE, '') <> 'InnoDB')) +
  (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()) +
  (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE()) +
  (SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE());
SELECT 'migration', version, checksum FROM schema_migrations ORDER BY version;
SELECT 'table', TABLE_NAME, TABLE_TYPE, COALESCE(ENGINE,'') FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME;
SELECT 'column', TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COALESCE(HEX(COLUMN_DEFAULT),'NULL'), HEX(EXTRA), HEX(GENERATION_EXPRESSION), COALESCE(CHARACTER_SET_NAME,''), COALESCE(COLLATION_NAME,''), ORDINAL_POSITION, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION;
SELECT 'constraint', tc.TABLE_NAME, tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, tc.ENFORCED, COALESCE(HEX(cc.CHECK_CLAUSE),'') FROM information_schema.TABLE_CONSTRAINTS tc LEFT JOIN information_schema.CHECK_CONSTRAINTS cc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.CONSTRAINT_SCHEMA=DATABASE() ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME;
SELECT 'index', TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COALESCE(COLUMN_NAME,''), COALESCE(COLLATION,''), COALESCE(SUB_PART,0), INDEX_TYPE, IS_VISIBLE, COALESCE(HEX(EXPRESSION),'') FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
SELECT 'key', TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, ORDINAL_POSITION, COALESCE(POSITION_IN_UNIQUE_CONSTRAINT,0), COALESCE(REFERENCED_TABLE_SCHEMA,''), COALESCE(REFERENCED_TABLE_NAME,''), COALESCE(REFERENCED_COLUMN_NAME,'') FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;
SELECT 'reference', TABLE_NAME, CONSTRAINT_NAME, UNIQUE_CONSTRAINT_SCHEMA, UNIQUE_CONSTRAINT_NAME, MATCH_OPTION, UPDATE_RULE, DELETE_RULE, REFERENCED_TABLE_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY TABLE_NAME, CONSTRAINT_NAME;"
capture_schema() {
  if ! (
    unset MYSQL_PWD MYSQL_HOST MYSQL_TCP_PORT MYSQL_UNIX_PORT MYSQL_GROUP_SUFFIX MYSQL_TEST_LOGIN_FILE
    mysql --defaults-file="$client_config" --no-login-paths \
      --protocol=SOCKET --socket="$db_socket" --batch --skip-column-names \
      --execute="$schema_query" "$database" 2>"$staging/schema.stderr"
  ) > "$1"; then
    fail 'Schema observation failed. Check the approved private client diagnostics and backup account metadata privileges.'
  fi
}
capture_schema "$staging/schema.before"
metadata validate "$staging/release.json" "$staging/schema.before" "$staging/BACKUP.json" || exit 1
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
capture_schema "$staging/schema.after"
metadata validate "$staging/release.json" "$staging/schema.after" "$staging/BACKUP.after.json" || exit 1
cmp --silent "$staging/schema.before" "$staging/schema.after" && cmp --silent "$staging/BACKUP.json" "$staging/BACKUP.after.json" || fail 'Database schema or migration history changed during the dump. No completed backup was published.'
# This detects observed changes; it does not lock out concurrent migrations or
# DDL that changes and changes back between observations. The operator must
# prevent migrations/DDL for the entire backup window.
[[ -s "$staging/database.sql.gz" ]] || fail 'The archive is empty.'
if ! gzip -t "$staging/database.sql.gz" 2>"$staging/gzip.stderr"; then
  fail 'Compressed archive validation failed. No completed backup was published.'
fi
# Preserve a non-sensitive warning indicator rather than possibly secret stderr.
warning=no
[[ ! -s "$staging/dump.stderr" ]] || warning=yes
rm -- "$staging/dump.stderr" "$staging/gzip.stderr" "$staging/schema.stderr" "$staging/release.json" "$staging/schema.before" "$staging/schema.after" "$staging/BACKUP.after.json"
printf 'format=aster-native-logical-v1\ncreated_utc=%s\ndatabase=%s\ntransport=local-unix-socket\ndump_warnings=%s\nencrypted=no\n' "$stamp" "$database" "$warning" > "$staging/BACKUP.txt"
(cd "$staging" && sha256sum database.sql.gz BACKUP.txt BACKUP.json > SHA256SUMS)
(cd "$staging" && sha256sum --check --status SHA256SUMS) || fail 'Checksum verification failed.'
# Publish the complete inventory as one directory on the same filesystem. GNU mv -n
# may report success on collision, so also prove that the staging name vanished.
mv --no-clobber --no-target-directory -- "$staging" "$final"
[[ ! -e "$staging" ]] || fail 'Destination already exists; existing backup was not overwritten.'
staging=''
printf 'Created %s (unencrypted). Verify, encrypt and copy off-host; this is not a restore test.\n' "$final"
[[ "$warning" == no ]] || printf '%s\n' 'mysqldump emitted warnings. Review the approved private diagnostics before accepting this recovery point.' >&2
