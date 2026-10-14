#!/usr/bin/env bash
# Fake mysqldump only. Exercises filesystem/pipe failure behavior, never a DB.
set -euo pipefail
umask 077
script_dir=$(cd "$(dirname "$0")" && pwd -P)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/aster-native-backup-test.XXXXXXXX")
trap 'rm -rf -- "$test_dir"' EXIT
mkdir -m 700 "$test_dir/bin" "$test_dir/private" "$test_dir/backups" "$test_dir/copied backups" "$test_dir/calls"
export ASTER_TEST_REAL_GZIP ASTER_TEST_REAL_MV ASTER_TEST_REAL_SHA ASTER_TEST_REAL_STAT
ASTER_TEST_REAL_GZIP=$(command -v gzip)
ASTER_TEST_REAL_MV=$(command -v mv)
ASTER_TEST_REAL_SHA=$(command -v sha256sum)
ASTER_TEST_REAL_STAT=$(command -v stat)
export ASTER_TEST_CALLS="$test_dir/calls"
cat > "$test_dir/private/client.cnf" <<'CNF'
# Test fixture only; not real credentials.
[client]
user=fixture_backup
password="fixture-not-a-real-secret"
CNF
chmod 600 "$test_dir/private/client.cnf"
# The cloud sandbox maps system-directory ownership to uid65534. Model a
# conventional root-owned Linux / and /tmp in this fixture only; endpoint and
# nested ancestor ownership/modes continue to use real filesystem metadata.
cat > "$test_dir/bin/stat" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
path=${!#}
if [[ $1 == -c && $2 == %u && ( "$path" == / || "$path" == /tmp ) ]]; then
  printf '%s\n' 0
else
  exec "$ASTER_TEST_REAL_STAT" "$@"
fi
MOCK
cat > "$test_dir/bin/mysql" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ $1 == --defaults-file=* ]] || exit 81
[[ ! ${MYSQL_PWD+set} && ! ${MYSQL_HOST+set} && ! ${MYSQL_GROUP_SUFFIX+set} ]] || exit 82
args=" $* "
[[ "$args" == *' --protocol=SOCKET '* && "$args" == *' --socket='* && "$args" == *' --no-login-paths '* && "$args" == *'--execute=SELECT'* ]] || exit 84
[[ ${ASTER_TEST_METADATA_FAIL:-0} == 0 ]] || exit 45
printf '%s\n' "${ASTER_TEST_SCHEMA_COUNT:-0}"
MOCK
cat > "$test_dir/bin/mysqldump" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ $1 == --defaults-file=* ]] || exit 81
[[ ! ${MYSQL_PWD+set} && ! ${MYSQL_HOST+set} && ! ${MYSQL_GROUP_SUFFIX+set} ]] || exit 82
printf '%s\n' "$@" > "$ASTER_TEST_CALLS/$$"
for arg; do
  case "$arg" in --password*|-p*|--databases|--all-databases|--force|--add-drop-table) exit 83 ;; esac
done
args=" $* "
[[ "$args" == *' --no-login-paths '* && "$args" == *' --protocol=SOCKET '* && "$args" == *' --socket='* && "$args" == *' --skip-add-drop-table '* && "$args" == *' --single-transaction '* ]] || exit 84
printf '%s\n' '-- fake SQL fixture; contains no database data' 'CREATE TABLE fixture (id INT);' 'INSERT INTO fixture VALUES (1);'
if [[ ${ASTER_TEST_DUMP_FAIL:-0} == 1 ]]; then
  printf '%s\n' 'fixture-private-diagnostic-do-not-log' >&2
  exit 42
fi
MOCK
cat > "$test_dir/bin/gzip" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ ${ASTER_TEST_GZIP_FAIL:-0} == 1 && $1 != -t ]]; then
  cat >/dev/null
  printf '%s\n' 'fixture-private-diagnostic-do-not-log' >&2
  exit 43
fi
if [[ ${ASTER_TEST_GZIP_CORRUPT:-0} == 1 && $1 != -t ]]; then
  cat >/dev/null
  printf '%s\n' 'not a valid gzip archive'
  exit 0
fi
exec "$ASTER_TEST_REAL_GZIP" "$@"
MOCK
cat > "$test_dir/bin/mv" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [[ ${ASTER_TEST_COLLISION:-0} == 1 ]]; then
  destination=${!#}
  mkdir -m 700 -- "$destination"
  printf '%s\n' 'existing-backup-must-survive' > "$destination/sentinel"
fi
exec "$ASTER_TEST_REAL_MV" "$@"
MOCK
cat > "$test_dir/bin/sha256sum" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ ${ASTER_TEST_SHA_FAIL:-0} == 0 ]] || exit 44
exec "$ASTER_TEST_REAL_SHA" "$@"
MOCK
cat > "$test_dir/bin/date" <<'MOCK'
#!/usr/bin/env bash
printf '%s\n' '20261014T000000Z'
MOCK
chmod 755 "$test_dir/bin/"*
export PATH="$test_dir/bin:$PATH"
script="$script_dir/backup-native.sh"
base_args=(--client-config "$test_dir/private/client.cnf" --socket "$test_dir/fake-mysql.sock" --database aster_fixture --output-dir "$test_dir/backups")
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
assert_clean() {
  [[ -z $(find "$test_dir/backups" -name '*.partial' -print -quit) ]] || fail 'staging data survived a handled failure'
}
expect_failure() {
  if "$@" > "$test_dir/result.log" 2>&1; then fail 'operation unexpectedly succeeded'; fi
  if rg -q 'fixture-not-a-real-secret|fixture-private-diagnostic-do-not-log' "$test_dir/result.log"; then fail 'private diagnostic or credential leaked'; fi
  assert_clean
}
# Predictable timestamp ensures that concurrency depends on random identity,
# not on waiting for the clock. Poisoned env must not influence client options.
pids=()
for _ in {1..8}; do
  MYSQL_PWD=fixture-not-a-real-secret MYSQL_HOST=not-a-real-host MYSQL_GROUP_SUFFIX=_bad \
    bash "$script" "${base_args[@]}" >/dev/null &
  pids+=("$!")
done
concurrent_failed=0
for pid in "${pids[@]}"; do wait "$pid" || concurrent_failed=1; done
((concurrent_failed == 0)) || fail 'concurrent backup failed'
[[ $(find "$test_dir/backups" -name database.sql.gz -type f | wc -l) == 8 ]] || fail 'concurrent runs overwrote a backup'
assert_clean
cp -R "$test_dir/backups/." "$test_dir/copied backups/"
for directory in "$test_dir/copied backups/"*; do
  (cd "$directory" && sha256sum --check --status SHA256SUMS && gzip -t database.sql.gz) || fail 'portable checksum/gzip validation failed'
done
[[ -z $(find "$test_dir/backups" -type d ! -perm 700 -print -quit) ]] || fail 'non-private output directory'
[[ -z $(find "$test_dir/backups" -type f ! -perm 600 -print -quit) ]] || fail 'non-private output file'
if rg -q -r '' 'fixture-not-a-real-secret' "$test_dir/backups" "$test_dir/calls"; then fail 'credential copied into output or command arguments'; fi
printf '%s\n' 'PASS: 8 concurrent same-second backups, private permissions, fixed socket/options, environment isolation, portable checksums (fake mysqldump)'

expect_failure env ASTER_TEST_DUMP_FAIL=1 bash "$script" "${base_args[@]}"
expect_failure env ASTER_TEST_GZIP_FAIL=1 bash "$script" "${base_args[@]}"
expect_failure env ASTER_TEST_GZIP_CORRUPT=1 bash "$script" "${base_args[@]}"
expect_failure env ASTER_TEST_SHA_FAIL=1 bash "$script" "${base_args[@]}"
[[ $(find "$test_dir/backups" -name database.sql.gz -type f | wc -l) == 8 ]] || fail 'a failed run published a backup'
printf '%s\n' 'PASS: dump, compression, compressed-data validation and checksum failures publish nothing; private diagnostics are not echoed'
expect_failure env ASTER_TEST_METADATA_FAIL=1 bash "$script" "${base_args[@]}"
expect_failure env ASTER_TEST_SCHEMA_COUNT=1 bash "$script" "${base_args[@]}"
expect_failure env ASTER_TEST_SCHEMA_COUNT=invalid bash "$script" "${base_args[@]}"
printf '%s\n' 'PASS: metadata failure, unsupported objects and malformed metadata stop before dumping'

for mode in 644 640 700; do
  chmod "$mode" "$test_dir/private/client.cnf"
  expect_failure bash "$script" "${base_args[@]}"
done
chmod 600 "$test_dir/private/client.cnf"
ln -s "$test_dir/private/client.cnf" "$test_dir/private/link.cnf"
expect_failure bash "$script" --client-config "$test_dir/private/link.cnf" --socket "$test_dir/fake-mysql.sock" --database aster_fixture --output-dir "$test_dir/backups"
ln "$test_dir/private/client.cnf" "$test_dir/private/hard.cnf"
expect_failure bash "$script" "${base_args[@]}"
rm "$test_dir/private/hard.cnf"
chmod 770 "$test_dir/private"
expect_failure bash "$script" "${base_args[@]}"
chmod 700 "$test_dir/private"
cp "$test_dir/private/client.cnf" "$test_dir/original.cnf"
for invalid in '!include /etc/mysql/my.cnf' '[mysqldump]' 'force' 'host=remote.example' 'init-command=SELECT 1' 'user=second_user' 'user='; do
  cp "$test_dir/original.cnf" "$test_dir/private/client.cnf"
  printf '%s\n' "$invalid" >> "$test_dir/private/client.cnf"
  expect_failure bash "$script" "${base_args[@]}"
done
cp "$test_dir/original.cnf" "$test_dir/private/client.cnf"
for db in '--all-databases' 'aster;DROP' 'aster/name' 'aster name' 'mysql' 'information_schema'; do
  expect_failure bash "$script" --client-config "$test_dir/private/client.cnf" --socket "$test_dir/fake-mysql.sock" --database "$db" --output-dir "$test_dir/backups"
done
chmod 755 "$test_dir/backups"
expect_failure bash "$script" "${base_args[@]}"
chmod 700 "$test_dir/backups"
expect_failure bash "$script" --client-config "$test_dir/private/client.cnf" --socket "$test_dir/fake-mysql.sock" --database aster_fixture --output-dir "$test_dir/not-created"
[[ ! -e "$test_dir/not-created" ]] || fail 'script created an unapproved output directory'
# Private endpoints below a non-sticky writable ancestor are still unsafe.
mkdir -m 700 "$test_dir/loose" "$test_dir/loose/private" "$test_dir/loose/output"
cp "$test_dir/original.cnf" "$test_dir/loose/private/client.cnf"
chmod 777 "$test_dir/loose"
expect_failure bash "$script" --client-config "$test_dir/loose/private/client.cnf" --socket "$test_dir/fake-mysql.sock" --database aster_fixture --output-dir "$test_dir/backups"
expect_failure bash "$script" --client-config "$test_dir/private/client.cnf" --socket "$test_dir/fake-mysql.sock" --database aster_fixture --output-dir "$test_dir/loose/output"
ln -s "$test_dir/backups" "$test_dir/output-link"
expect_failure bash "$script" --client-config "$test_dir/private/client.cnf" --socket "$test_dir/fake-mysql.sock" --database aster_fixture --output-dir "$test_dir/output-link/"
[[ $(find "$test_dir/calls" -type f | wc -l) == 12 ]] || fail 'preflight failure reached mysqldump'
printf '%s\n' 'PASS: unsafe config modes/links/options, writable config directory/ancestors, output symlink, unsafe identifiers and output paths rejected before dump'

expect_failure env ASTER_TEST_COLLISION=1 bash "$script" "${base_args[@]}"
[[ $(find "$test_dir/backups" -name sentinel -type f | wc -l) == 1 ]] || fail 'collision target was replaced'
sentinel=$(find "$test_dir/backups" -name sentinel -type f)
[[ $(cat "$sentinel") == existing-backup-must-survive ]] || fail 'collision target contents changed'
[[ $(find "$test_dir/backups" -name database.sql.gz -type f | wc -l) == 8 ]] || fail 'collision published a new archive'
printf '%s\n' 'PASS: deterministic publish collision preserves the existing directory and cleans only this run staging'
chmod 400 "$test_dir/private/client.cnf"
bash "$script" "${base_args[@]}" >/dev/null
assert_clean
printf '%s\n' 'PASS: read-only private config accepted. All tests use fakebin with modeled system-root ownership; no MySQL connection or native service boot was tested.'
