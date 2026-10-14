#!/usr/bin/env bash
# Disposable native MySQL 8.4 fixture; never install a service or alter host users.
# Usage: bash mysql-native.sh [--archive /path/to/reviewed.tar.xz] -- command [args...]
# RUNNER_TEMP must be an existing private CI scratch directory. Ubuntu 24.04
# native runtime libraries must be provisioned by the workflow, not this script.
# An offline archive still requires the reviewed, committed manifest checksum.
set +x
set -euo pipefail
umask 077

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
archive_source=''
if [[ ${1:-} == --archive ]]; then
  [[ $# -ge 3 ]] || fail 'Usage: mysql-native.sh [--archive FILE] -- command [args...]'
  archive_source=$2
  shift 2
fi
[[ ${1:-} == -- && $# -ge 2 ]] || fail 'Usage: mysql-native.sh [--archive FILE] -- command [args...]'
shift
command -v python3 >/dev/null 2>&1 || fail 'python3 is required to validate the distribution manifest.'
controller_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)

# This gate precedes every download, archive extraction and database execution.
# Never accept a caller-supplied hash, URL or already-extracted executable tree.
if ! metadata=$(python3 - "$controller_dir/mysql-distribution.json" <<'PY'
import json
from pathlib import Path
import re
import sys
try:
    value = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("schema") != 1:
        raise ValueError("unsupported distribution manifest schema")
    if value.get("status") != "verified":
        raise ValueError("native MySQL distribution is awaiting verified provenance and SHA-256; CI is blocked")
    version = value.get("version")
    digest = value.get("sha256")
    if not isinstance(version, str) or re.fullmatch(r"8\.4\.[0-9]+", version) is None:
        raise ValueError("only a reviewed MySQL 8.4 patch release is accepted")
    if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None or digest == "0" * 64:
        raise ValueError("a reviewed, nonempty SHA-256 is required")
    archive = f"mysql-{version}-linux-glibc2.28-x86_64-minimal.tar.xz"
    url = f"https://cdn.mysql.com/Downloads/MySQL-8.4/{archive}"
    if value.get("archive") != archive or value.get("download_url") != url:
        raise ValueError("distribution archive or official URL does not match the reviewed version")
    print(version)
    print(digest)
    print(url)
except (OSError, ValueError, TypeError) as error:
    print(f"FAIL: {error}", file=sys.stderr)
    raise SystemExit(1)
PY
); then
  exit 1
fi
mapfile -t distribution <<<"$metadata"
mysql_version=${distribution[0]}
mysql_sha256=${distribution[1]}
mysql_url=${distribution[2]}

[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || fail 'Native MySQL CI requires Linux amd64.'
[[ $EUID != 0 ]] || fail 'Run this disposable fixture as an unprivileged CI user, never root.'
[[ -n ${RUNNER_TEMP:-} && -d $RUNNER_TEMP && -w $RUNNER_TEMP ]] || fail 'RUNNER_TEMP must identify an existing writable CI scratch directory.'
for tool in tar xz sha256sum mktemp cp setsid timeout; do
  command -v "$tool" >/dev/null 2>&1 || fail "Required command unavailable: $tool"
done
if [[ -z $archive_source ]]; then
  command -v curl >/dev/null 2>&1 || fail 'curl is required unless --archive is supplied.'
else
  [[ -f $archive_source && -r $archive_source ]] || fail 'The specified offline archive is not a readable file.'
fi

# Ignore inherited MySQL passwords, login paths, server options and test DSNs.
for variable in ${!MYSQL_@} ${!MYSQLTEST_@} ASTER_MYSQL_TEST_DSN; do unset "$variable"; done
fixture_tmp=$(mktemp -d "$RUNNER_TEMP/aster-mysql.XXXXXXXX")
mysql_pid=''
command_pid=''
running_job() {
  local expected=$1 current
  [[ -n $expected ]] || return 1
  while IFS= read -r current; do
    [[ $current == "$expected" ]] && return 0
  done < <(jobs -pr)
  return 1
}
stop_job() {
  local owned=$1 group=${2:-false}
  [[ -n $owned ]] || return 0
  if running_job "$owned"; then
    if [[ $group == true ]]; then
      kill -TERM -- "-$owned" 2>/dev/null || kill -TERM -- "$owned" 2>/dev/null || true
    else
      kill -TERM -- "$owned" 2>/dev/null || true
    fi
    for ((attempt = 0; attempt < 100; attempt++)); do
      running_job "$owned" || break
      sleep 0.1
    done
    if running_job "$owned"; then
      if [[ $group == true ]]; then
        kill -KILL -- "-$owned" 2>/dev/null || kill -KILL -- "$owned" 2>/dev/null || true
      else
        kill -KILL -- "$owned" 2>/dev/null || true
      fi
    fi
  fi
  wait "$owned" 2>/dev/null || true
}
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  stop_job "$command_pid" true
  stop_job "$mysql_pid"
  rm -rf -- "$fixture_tmp"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

archive_path="$fixture_tmp/mysql.tar.xz"
if [[ -n $archive_source ]]; then
  cp -- "$archive_source" "$archive_path"
else
  # No retries/fallback mirror: a refusal or failed transfer stops this run.
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 20 --max-time 300 --output "$archive_path" "$mysql_url"
fi
printf '%s  %s\n' "$mysql_sha256" "$archive_path" | sha256sum --check --status \
  || fail 'Native MySQL archive SHA-256 mismatch; refusing extraction and execution.'
mkdir "$fixture_tmp/distribution" "$fixture_tmp/data" "$fixture_tmp/tmp"
tar --extract --xz --file "$archive_path" --directory "$fixture_tmp/distribution" \
  --strip-components=1 --no-same-owner --no-same-permissions
mysql_root="$fixture_tmp/distribution"
for binary in mysqld mysql; do
  [[ -f $mysql_root/bin/$binary && ! -L $mysql_root/bin/$binary && -x $mysql_root/bin/$binary ]] \
    || fail "Verified archive lacks the expected $binary executable."
done
if ! server_version=$(timeout --signal=TERM --kill-after=1s 10s \
  "$mysql_root/bin/mysqld" --no-defaults --version 2>/dev/null); then
  fail 'Native MySQL executable cannot run; check the reviewed Ubuntu runtime library prerequisites.'
fi
[[ $server_version == *"Ver $mysql_version "* ]] || fail 'Native executable version does not match the reviewed manifest.'

# A public test fixture credential, never a production secret. The root account
# is locked by init-file before the server accepts connections. No inherited
# defaults/login files are read, and no existing host MySQL instance is touched.
fixture_password='AsterCiFixtureOnly2026'
cat >"$fixture_tmp/bootstrap.sql" <<'SQL'
CREATE DATABASE aster_ci_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'aster_ci'@'127.0.0.1' IDENTIFIED BY 'AsterCiFixtureOnly2026';
GRANT ALL PRIVILEGES ON *.* TO 'aster_ci'@'127.0.0.1';
ALTER USER 'root'@'localhost' ACCOUNT LOCK;
SQL
socket_path="$fixture_tmp/mysql.sock"
python3 - "$socket_path" <<'PY'
import os
import sys
if len(os.fsencode(sys.argv[1])) > 107:
    raise SystemExit("FAIL: RUNNER_TEMP path is too long for the private MySQL socket")
PY
timeout --signal=TERM --kill-after=5s 120s "$mysql_root/bin/mysqld" --no-defaults --initialize-insecure \
  --basedir="$mysql_root" --datadir="$fixture_tmp/data" --tmpdir="$fixture_tmp/tmp" \
  >"$fixture_tmp/initialize.log" 2>&1 &
mysql_pid=$!
if ! wait "$mysql_pid"; then
  fail 'Native MySQL initialization failed; no existing database was used.'
fi
mysql_pid=''
mysql_port=$(python3 - <<'PY'
import socket
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
    listener.bind(("127.0.0.1", 0))
    print(listener.getsockname()[1])
PY
)
"$mysql_root/bin/mysqld" --no-defaults --basedir="$mysql_root" --datadir="$fixture_tmp/data" \
  --tmpdir="$fixture_tmp/tmp" --socket="$socket_path" --pid-file="$fixture_tmp/mysql.pid" \
  --log-error="$fixture_tmp/mysql.log" --init-file="$fixture_tmp/bootstrap.sql" \
  --bind-address=127.0.0.1 --port="$mysql_port" --mysqlx=0 --skip-name-resolve \
  --skip-log-bin --local-infile=0 --secure-file-priv=NULL --default-time-zone=+00:00 \
  --innodb-buffer-pool-size=128M >"$fixture_tmp/server.log" 2>&1 &
mysql_pid=$!
ready=false
readiness_deadline=$((SECONDS + 45))
while ((SECONDS < readiness_deadline)); do
  running_job "$mysql_pid" || fail 'The owned native MySQL process exited before readiness.'
  if actual_version=$(MYSQL_PWD="$fixture_password" timeout --signal=TERM --kill-after=1s 2s \
    "$mysql_root/bin/mysql" --no-defaults --no-login-paths \
    --protocol=TCP --host=127.0.0.1 --port="$mysql_port" --user=aster_ci --ssl-mode=DISABLED \
    --connect-timeout=1 --batch --skip-column-names --execute='SELECT VERSION()' 2>/dev/null); then
    [[ $actual_version == "$mysql_version" ]] || fail 'Running MySQL version does not match the reviewed manifest.'
    ready=true
    break
  fi
  sleep 1
done
[[ $ready == true ]] || fail 'Native MySQL did not become ready within the bounded startup wait.'
running_job "$mysql_pid" || fail 'The owned native MySQL exited; refusing to run tests against another process.'
rm -- "$fixture_tmp/bootstrap.sql"
printf 'Native MySQL %s ready on an isolated loopback fixture.\n' "$mysql_version"
export ASTER_MYSQL_TEST_DSN="aster_ci:$fixture_password@tcp(127.0.0.1:$mysql_port)/aster_ci_test?parseTime=true"
# Keep a session leader alive until cleanup even when the command exits before
# its descendants. It anchors the process-group ID, so cleanup cannot signal a
# reused PID/group. On TERM it waits until group members stop; the shell applies
# a bounded KILL to the still-owned leader/group if a descendant ignores TERM.
setsid --wait -- python3 - "$fixture_tmp/command-status" "$@" <<'PY' &
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

stopping = False

def stop(*_):
    global stopping
    stopping = True

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
process = subprocess.Popen(sys.argv[2:])
while process.poll() is None and not stopping:
    time.sleep(0.05)
if process.returncode is not None:
    code = process.returncode if process.returncode >= 0 else 128 - process.returncode
    status = Path(sys.argv[1])
    pending = status.with_suffix(".pending")
    pending.write_text(str(code), encoding="ascii")
    pending.replace(status)
while not stopping:
    time.sleep(0.05)
while True:
    process.poll()
    live_members = False
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal() or int(entry.name) == os.getpid():
            continue
        try:
            # comm may contain spaces/parentheses; fields after its final ')' are
            # state, ppid, process group. Zombies no longer execute or hold files.
            fields = (entry / "stat").read_text().rsplit(")", 1)[1].split()
            if int(fields[2]) == os.getpgrp() and fields[0] != "Z":
                live_members = True
                break
        except (OSError, ValueError, IndexError):
            continue
    if not live_members:
        break
    time.sleep(0.05)
PY
command_pid=$!
while [[ ! -f $fixture_tmp/command-status ]]; do
  running_job "$command_pid" || fail 'The owned command supervisor exited without a result.'
  sleep 0.1
done
result=$(cat "$fixture_tmp/command-status")
[[ $result =~ ^[0-9]+$ && $result -le 255 ]] || fail 'The owned command returned an invalid status.'
unset ASTER_MYSQL_TEST_DSN
[[ $result == 0 ]] || exit "$result"
running_job "$mysql_pid" || fail 'The owned native MySQL exited while the checks ran.'
printf 'Native MySQL fixture checks passed; stopping the owned server.\n'
