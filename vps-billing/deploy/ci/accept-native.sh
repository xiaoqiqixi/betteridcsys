#!/usr/bin/env bash
# Native acceptance on one disposable Ubuntu 24.04 GitHub-hosted runner.
# Never run against a user server. mysql-native.sh owns the database process.
# Usage: accept-native.sh --allow-isolated-runner SOURCE_ROOT EVIDENCE_DIR
set +x
set -euo pipefail
umask 077
fail() { printf 'FAIL native acceptance: %s\n' "$*" >&2; exit 1; }
step() { printf '\n== Native acceptance: %s ==\n' "$*"; }
[[ $# == 3 && $1 == --allow-isolated-runner ]] || fail 'Explicit isolated-runner opt-in, source root and new evidence directory required.'
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted ]] || fail 'Only disposable GitHub-hosted Actions runners are accepted.'
[[ ${GITHUB_REPOSITORY:-} == xiaoqiqixi/betteridcsys ]] || fail 'Unexpected repository; no privileged actions permitted.'
[[ ${GITHUB_RUN_ID:-} =~ ^[0-9]+$ && ${GITHUB_RUN_ATTEMPT:-} =~ ^[0-9]+$ ]] || fail 'Missing run identity.'
[[ $EUID != 0 && $(uname -s) == Linux && $(uname -m) == x86_64 ]] || fail 'Start as the ordinary Linux amd64 runner account.'
[[ $(cat /proc/1/comm) == systemd ]] || fail 'PID 1 must be systemd; no simulated service acceptance.'
python3 - <<'PY'
from pathlib import Path
values = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
if values.get('ID', '').strip('"') != 'ubuntu' or values.get('VERSION_ID', '').strip('"') != '24.04':
    raise SystemExit('FAIL: native acceptance requires Ubuntu 24.04')
PY
source_root=$(cd -- "$2" && pwd -P)
project="$source_root/vps-billing"
[[ $3 == /* && ! -e $3 && -d $(dirname -- "$3") ]] || fail 'Evidence directory must be a new absolute path with an existing parent.'
evidence=$3
[[ -n ${ASTER_ACCEPT_NGINX_BIN:-} && $ASTER_ACCEPT_NGINX_BIN == /* && -f $ASTER_ACCEPT_NGINX_BIN && ! -L $ASTER_ACCEPT_NGINX_BIN && -x $ASTER_ACCEPT_NGINX_BIN ]] || fail 'Provide the authenticated Ubuntu package nginx binary via ASTER_ACCEPT_NGINX_BIN.'
for variable in ASTER_NATIVE_MYSQL_ROOT ASTER_NATIVE_MYSQL_SOCKET ASTER_NATIVE_MYSQL_ADMIN_CNF ASTER_NATIVE_MYSQL_FIXTURE_ROOT; do
  [[ -n ${!variable:-} && ${!variable} == /* ]] || fail "Missing native MySQL fixture contract: $variable"
done
mysql_root=$ASTER_NATIVE_MYSQL_ROOT
mysql_socket=$ASTER_NATIVE_MYSQL_SOCKET
admin_cnf=$ASTER_NATIVE_MYSQL_ADMIN_CNF
fixture_root=$ASTER_NATIVE_MYSQL_FIXTURE_ROOT
[[ -S $mysql_socket && -f $admin_cnf && ! -L $admin_cnf ]] || fail 'MySQL fixture socket/private client file unavailable.'
[[ $(realpath -e "$mysql_socket") == "$fixture_root/"* ]] || fail 'Socket does not belong to the declared disposable fixture.'
[[ $(stat -c %a "$admin_cnf") == 600 && $(stat -c %u "$admin_cnf") == "$EUID" ]] || fail 'Fixture client file must be private and runner-owned.'
for tool in go npm python3 openssl curl sudo systemctl systemd-analyze install useradd userdel groupdel getent gzip sha256sum timeout; do
  command -v "$tool" >/dev/null || fail "Required native tool unavailable: $tool"
done
sudo -n true || fail 'Passwordless sudo is required on this disposable runner.'
mysql_cmd=("$mysql_root/bin/mysql" "--defaults-file=$admin_cnf" --no-login-paths --protocol=SOCKET "--socket=$mysql_socket" --batch --skip-column-names)
server_data=$("${mysql_cmd[@]}" --execute='SELECT @@datadir' 2>/dev/null) || fail 'Could not verify owned native MySQL identity.'
[[ $(realpath -e "$server_data") == "$fixture_root/data" ]] || fail 'Refusing any database outside the owned fixture data directory.'
for variable in ${!APP_@} ${!SESSION_SECRET@} ${!MYSQL_@} ${!BOOTSTRAP_@} ${!TRUSTED_PROXY@} ${!PAYMENT_PROVIDER@} ${!EMAIL_PROVIDER@} ${!INTEGRATIONS_CONFIG@} ${!LISTEN_ADDR@}; do unset "$variable"; done
export NO_PROXY=localhost,127.0.0.1,::1 no_proxy=localhost,127.0.0.1,::1 PYTHONDONTWRITEBYTECODE=1
mkdir -m 700 -- "$evidence"
scratch=$(mktemp -d "${RUNNER_TEMP:?}/aster-native-accept.XXXXXXXX")
identity="${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-$$"
api_user="astapi$$"; web_user="astweb$$"
opt="/opt/aster-ci-$identity"; config="/etc/aster-ci-$identity"
logs="/var/log/aster-ci-$identity"; run="/run/aster-ci-$identity"
api_unit="aster-ci-api-$identity.service"; web_unit="aster-ci-web-$identity.service"
db="aster_native_test_${GITHUB_RUN_ID}_$$"; restored="aster_restore_test_${GITHUB_RUN_ID}_$$"
[[ ${#db} -le 64 && ${#restored} -le 64 ]] || fail 'Run identity exceeds safe database name length.'
created_paths=(); created_units=(); created_users=(); db_created=false
cleanup() {
  test_result=$?
  trap - EXIT INT TERM
  set +e
  cleanup_failed=false
  units_stopped=true
  if [[ $test_result != 0 ]]; then
    for unit in "${created_units[@]}"; do
      sudo -n systemctl show "$unit" -p LoadState -p ActiveState -p SubState -p Result -p ExecMainCode -p ExecMainStatus -p StatusErrno >> "$evidence/failure-unit-status.txt" 2>/dev/null
    done
  fi
  for unit in "${created_units[@]}"; do
    sudo -n systemctl stop --no-block "$unit" >/dev/null 2>&1
  done
  for unit in "${created_units[@]}"; do
    stopped=false
    for ((attempt=0; attempt<25; attempt++)); do
      state=$(sudo -n systemctl show "$unit" -p ActiveState --value 2>/dev/null)
      if [[ $state == inactive || $state == failed ]]; then stopped=true; break; fi
      sleep 0.2
    done
    if [[ $stopped != true ]]; then
      sudo -n systemctl kill --kill-whom=all --signal=KILL "$unit" >/dev/null 2>&1
      for ((attempt=0; attempt<15; attempt++)); do
        state=$(sudo -n systemctl show "$unit" -p ActiveState --value 2>/dev/null)
        if [[ $state == inactive || $state == failed ]]; then stopped=true; break; fi
        sleep 0.2
      done
    fi
    if [[ $stopped != true ]]; then units_stopped=false; cleanup_failed=true; fi
  done
  if [[ $units_stopped == true ]]; then
    for unit in "${created_units[@]}"; do
      sudo -n systemctl reset-failed "$unit" >/dev/null 2>&1
      sudo -n rm -f -- "/etc/systemd/system/$unit" || cleanup_failed=true
    done
    if ((${#created_units[@]})); then sudo -n systemctl daemon-reload >/dev/null 2>&1 || cleanup_failed=true; fi
    for user in "${created_users[@]}"; do
      sudo -n userdel "$user" >/dev/null 2>&1 || cleanup_failed=true
      if getent group "$user" >/dev/null; then sudo -n groupdel "$user" >/dev/null 2>&1 || cleanup_failed=true; fi
    done
    if [[ $db_created == true && -f $scratch/cleanup.sql ]]; then
      timeout --signal=TERM --kill-after=1s 5s "${mysql_cmd[@]}" < "$scratch/cleanup.sql" >/dev/null 2>&1 || cleanup_failed=true
    fi
    for path in "${created_paths[@]}"; do
      case "$path" in "$opt"|"$config"|"$logs"|"$run") sudo -n rm -rf -- "$path" || cleanup_failed=true ;; *) cleanup_failed=true ;; esac
    done
  fi
  for unit in "${created_units[@]}"; do [[ ! -e /etc/systemd/system/$unit ]] || cleanup_failed=true; done
  for user in "${created_users[@]}"; do
    if getent passwd "$user" >/dev/null || getent group "$user" >/dev/null; then cleanup_failed=true; fi
  done
  for path in "${created_paths[@]}"; do [[ ! -e $path ]] || cleanup_failed=true; done
  rm -rf -- "$scratch" || cleanup_failed=true
  result=$test_result
  [[ $cleanup_failed == false ]] || result=1
  if [[ -d $evidence ]]; then
    printf '{"test_exit_code":%s,"exit_code":%s,"owned_resources_removed":%s}\n' "$test_result" "$result" "$([[ $cleanup_failed == false ]] && echo true || echo false)" > "$evidence/cleanup.json"
    printf 'NATIVE_CLEANUP_JSON=%s\n' "$(cat -- "$evidence/cleanup.json")"
  fi
  if [[ $test_result != 0 && -f $evidence/failure-unit-status.txt ]]; then cat -- "$evidence/failure-unit-status.txt"; fi
  [[ $cleanup_failed == false ]] || printf 'FAIL: owned native acceptance resources could not all be cleaned; inspect cleanup.json and the isolated runner.\n' >&2
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for user in "$api_user" "$web_user"; do
  if getent passwd "$user" >/dev/null || getent group "$user" >/dev/null; then fail 'Refusing to reuse an existing OS identity/group.'; fi
done
for path in "$opt" "$config" "$logs" "$run" "/etc/systemd/system/$api_unit" "/etc/systemd/system/$web_unit"; do [[ ! -e $path && ! -L $path ]] || fail 'Refusing to reuse an existing privileged path.'; done

step 'Build versioned source into two same-schema release directories'
(cd "$project/backend" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -buildvcs=false -o "$scratch/aster-api" ./cmd/server)
(cd "$project/frontend" && npm ci --include=dev --no-audit --no-fund && npm run build)
for user in "$api_user" "$web_user"; do
  sudo -n useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin "$user"
  created_users+=("$user")
done
for path in "$opt" "$config" "$logs" "$run"; do
  sudo -n mkdir -- "$path"; created_paths+=("$path")
  sudo -n chmod 755 "$path"
done
sudo -n install -d -m 755 "$opt/releases/a/bin" "$opt/releases/a/web" "$opt/releases/b/bin" "$opt/releases/b/web" "$opt/tools"
for version in a b; do
  sudo -n install -m 755 "$scratch/aster-api" "$opt/releases/$version/bin/aster-api"
  sudo -n cp -R "$project/frontend/dist/." "$opt/releases/$version/web/"
  sudo -n find "$opt/releases/$version/web" -type d -exec chmod 755 '{}' +
  sudo -n find "$opt/releases/$version/web" -type f -exec chmod 644 '{}' +
  printf '%s\n' "$version" > "$scratch/release-id"
  sudo -n install -m 644 "$scratch/release-id" "$opt/releases/$version/web/release-id.txt"
done
sudo -n install -m 755 "$ASTER_ACCEPT_NGINX_BIN" "$opt/tools/nginx"
sudo -n ln -s "$opt/releases/a" "$opt/current"
sudo -n install -d -o root -g "$api_user" -m 750 "$config/secrets"

step 'Create isolated roles, private fixture credentials and synthetic TLS trust'
python3 - "$scratch" "$db" "$restored" "$mysql_socket" "$run" <<'PY'
import json
from pathlib import Path
import secrets
import sys
root, database, restored, socket, run = sys.argv[1:]
p = Path(root)
values = {key: secrets.token_hex(24) for key in ('runtime','migrator','backup','restore','restore_runtime','session','admin','customer','second')}
(p/'accounts.json').write_text(json.dumps(values))
for key in ('admin','customer','second','session'):
    (p/key).write_text(values[key]+'\n')
for role in ('runtime','migrator','backup','restore','restore_runtime'):
    account = 'an_'+role+'_'+str(__import__('os').getppid())
    values[role+'_user'] = account
    (p/(role+'.cnf')).write_text('[client]\nuser='+account+'\npassword='+values[role]+'\n')
    target = restored if role in ('restore','restore_runtime') else database
    (p/(role+'.dsn')).write_text(f'{account}:{values[role]}@unix({socket})/{target}?parseTime=true\n')
    if role in ('runtime','restore_runtime'):
        (p/(role+'.service.dsn')).write_text(f'{account}:{values[role]}@unix({run}/mysql.sock)/{target}?parseTime=true\n')
(p/'accounts.json').write_text(json.dumps(values))
lines = [f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;' for name in (database,restored)]
for role in ('runtime','migrator','backup','restore','restore_runtime'):
    user = values[role+'_user']
    lines += [f"CREATE USER '{user}'@'localhost' IDENTIFIED BY '{values[role]}';"]
    target = restored if role in ('restore','restore_runtime') else database
    privileges = 'SELECT,INSERT,UPDATE,DELETE' if role in ('runtime','restore_runtime') else 'ALL PRIVILEGES'
    if role == 'migrator': privileges = 'SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES'
    if role == 'backup': privileges = 'SELECT,SHOW VIEW,TRIGGER,EVENT'
    lines += [f"GRANT {privileges} ON `{target}`.* TO '{user}'@'localhost';"]
    if role == 'backup': lines += [f"GRANT SHOW_ROUTINE ON *.* TO '{user}'@'localhost';"]
(p/'setup.sql').write_text('\n'.join(lines)+'\n')
(p/'cleanup.sql').write_text('\n'.join([f'DROP DATABASE IF EXISTS `{name}`;' for name in (database,restored)] + [f"DROP USER IF EXISTS '{values[role+'_user']}'@'localhost';" for role in ('runtime','migrator','backup','restore','restore_runtime')])+'\n')
PY
# Mark cleanup before executing because MySQL DDL can commit partially.
db_created=true
"${mysql_cmd[@]}" < "$scratch/setup.sql" > "$scratch/setup.log" 2>&1 || fail 'Isolated database role setup failed.'
for name in session runtime.service.dsn; do sudo -n install -o root -g "$api_user" -m 640 "$scratch/$name" "$config/secrets/$name"; done
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$scratch/ca.key" -out "$scratch/ca.pem" -days 1 -subj '/CN=Aster isolated CI test CA' -addext 'basicConstraints=critical,CA:TRUE' > "$scratch/openssl.log" 2>&1
openssl req -new -newkey rsa:2048 -nodes -keyout "$scratch/server.key" -out "$scratch/server.csr" -subj '/CN=localhost' >> "$scratch/openssl.log" 2>&1
printf 'subjectAltName=DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' > "$scratch/server.ext"
openssl x509 -req -in "$scratch/server.csr" -CA "$scratch/ca.pem" -CAkey "$scratch/ca.key" -CAcreateserial -out "$scratch/server.pem" -days 1 -extfile "$scratch/server.ext" >> "$scratch/openssl.log" 2>&1
sudo -n install -m 600 "$scratch/server.key" "$config/server.key"
sudo -n install -m 644 "$scratch/server.pem" "$config/server.pem"
ports=$(python3 - <<'PY'
import socket
listeners=[]
for _ in range(3):
    s=socket.socket(); s.bind(('127.0.0.1',0)); listeners.append(s)
print(' '.join(str(s.getsockname()[1]) for s in listeners))
PY
)
read -r api_port http_port tls_port <<< "$ports"
origin="https://localhost:$tls_port"
cli_env=(env -i APP_MODE=production "APP_ORIGIN=$origin" "SESSION_SECRET_FILE=$scratch/session" MYSQL_ALLOW_INSECURE=true PAYMENT_PROVIDER=payment.disabled EMAIL_PROVIDER=email.disabled)
"${cli_env[@]}" "MYSQL_DSN_FILE=$scratch/migrator.dsn" "$opt/releases/a/bin/aster-api" -migrate > "$scratch/migrate.log" 2>&1
"${cli_env[@]}" "MYSQL_DSN_FILE=$scratch/migrator.dsn" "$opt/releases/a/bin/aster-api" -migrate >> "$scratch/migrate.log" 2>&1
for role in admin customer second; do
  account_role=customer; [[ $role != admin ]] || account_role=admin
  "${cli_env[@]}" "MYSQL_DSN_FILE=$scratch/runtime.dsn" "BOOTSTRAP_EMAIL=$role@native-ci.invalid" "BOOTSTRAP_NAME=Native CI $role" "BOOTSTRAP_ROLE=$account_role" "BOOTSTRAP_PASSWORD_FILE=$scratch/$role" "$opt/releases/a/bin/aster-api" -create-user >> "$scratch/bootstrap.log" 2>&1
done
"${mysql_cmd[@]}" "$db" --execute="UPDATE plans SET available=TRUE; UPDATE plan_prices SET available=TRUE; CREATE TABLE permission_probe(id INT) ENGINE=InnoDB;" > "$scratch/seed.log" 2>&1
runtime_mysql=("$mysql_root/bin/mysql" "--defaults-file=$scratch/runtime.cnf" --no-login-paths --protocol=SOCKET "--socket=$mysql_socket" --batch --skip-column-names "$db")
runtime_db_user=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["runtime_user"])' "$scratch/accounts.json")
"${mysql_cmd[@]}" "$restored" --execute='CREATE TABLE permission_canary(id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO permission_canary VALUES(1);' >/dev/null
[[ $("${mysql_cmd[@]}" "$restored" --execute='SELECT id FROM permission_canary') == 1 ]] || fail 'Cross-database permission canary was not created.'
for sql in 'CREATE TABLE forbidden_probe(id INT)' 'ALTER TABLE permission_probe ADD COLUMN forbidden INT' 'DROP TABLE permission_probe' "GRANT SELECT ON \`$db\`.* TO '$runtime_db_user'@'localhost'" "SELECT * FROM \`$restored\`.permission_canary"; do
  if "${runtime_mysql[@]}" --execute="$sql" > "$scratch/denied.log" 2>&1; then fail 'Runtime database identity unexpectedly obtained privileged/cross-database access.'; fi
  grep -Eq '^ERROR (1044|1142|1143|1227) ' "$scratch/denied.log" || fail 'A negative privilege test failed for a reason other than access denial.'
done
"${mysql_cmd[@]}" "$db" --execute='DROP TABLE permission_probe' >/dev/null
"${mysql_cmd[@]}" "$restored" --execute='DROP TABLE permission_canary' >/dev/null

step 'Render and start the hardened API and dedicated nginx units'
python3 - "$project" "$scratch" "$opt" "$config" "$logs" "$run" "$api_user" "$web_user" "$api_port" "$http_port" "$tls_port" "$mysql_socket" <<'PY'
from pathlib import Path
import sys
project,scratch,opt,config,logs,run,api_user,web_user,api_port,http_port,tls_port,mysql_socket=sys.argv[1:]
p=Path(scratch)
unit=Path(project+'/deploy/systemd/aster-api.service').read_text()
unit=unit.replace('/opt/aster',opt).replace('/etc/aster',config).replace('User=aster','User='+api_user).replace('Group=aster','Group='+api_user)
unit=unit.replace('After=network-online.target mysql.service','After=network-online.target').replace('SyslogIdentifier=aster-api','SyslogIdentifier='+api_user)
unit=unit.replace('[Install]',f'BindReadOnlyPaths={mysql_socket}:{run}/mysql.sock\n\n[Install]')
(p/'api.service').write_text(unit)
env=Path(project+'/deploy/systemd/api.env.example').read_text().replace('https://billing.example.com','https://localhost:'+tls_port).replace('127.0.0.1:18080','127.0.0.1:'+api_port).replace('/etc/aster',config).replace('session_secret','session').replace('mysql_runtime_dsn','runtime.service.dsn').replace('MYSQL_ALLOW_INSECURE=false','MYSQL_ALLOW_INSECURE=true')
(p/'api.env').write_text(env)
web=Path(project+'/deploy/nginx.native.conf').read_text().replace('/opt/aster',opt).replace('billing.example.com','localhost')
web=web.replace('/etc/letsencrypt/live/localhost/fullchain.pem',config+'/server.pem').replace('/etc/letsencrypt/live/localhost/privkey.pem',config+'/server.key')
web=web.replace('/var/log/nginx/aster.access.log',logs+'/access.log').replace('/var/log/nginx/aster.error.log',logs+'/error.log')
web=web.replace('listen 80','listen 127.0.0.1:'+http_port).replace('listen 443','listen 127.0.0.1:'+tls_port)
web='\n'.join(line for line in web.splitlines() if 'listen [::]' not in line)+'\n'
web=web.replace('return 308 https://localhost$request_uri','return 308 https://localhost:'+tls_port+'$request_uri').replace('127.0.0.1:18080','127.0.0.1:'+api_port)
(p/'site.conf').write_text(web)
(p/'nginx.conf').write_text(f'''user {web_user};
worker_processes 1;
pid {run}/nginx.pid;
error_log {logs}/nginx-error.log warn;
events {{ worker_connections 128; }}
http {{
  types {{ text/html html; text/css css; application/javascript js; application/json json; font/woff2 woff2; image/svg+xml svg; }}
  default_type application/octet-stream;
  client_body_temp_path {run}/client_temp;
  proxy_temp_path {run}/proxy_temp;
  fastcgi_temp_path {run}/fastcgi_temp;
  uwsgi_temp_path {run}/uwsgi_temp;
  scgi_temp_path {run}/scgi_temp;
  include {config}/site.conf;
}}
''')
(p/'web.service').write_text(f'''[Unit]
Description=Aster isolated native acceptance nginx
[Service]
Type=simple
ExecStart={opt}/tools/nginx -e {logs}/nginx-bootstrap.log -p {run}/ -c {config}/nginx.conf -g "daemon off;"
ExecReload={opt}/tools/nginx -e {logs}/nginx-bootstrap.log -p {run}/ -c {config}/nginx.conf -s reload
KillMode=control-group
TimeoutStopSec=15
Restart=no
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths={logs} {run}
[Install]
WantedBy=multi-user.target
''')
PY
sudo -n install -o root -g "$api_user" -m 640 "$scratch/api.env" "$config/api.env"
for file in site.conf nginx.conf; do sudo -n install -m 644 "$scratch/$file" "$config/$file"; done
for pair in "api:$api_unit" "web:$web_unit"; do
  sudo -n install -m 644 "$scratch/${pair%%:*}.service" "/etc/systemd/system/${pair#*:}"
  created_units+=("${pair#*:}")
done
sudo -n systemd-analyze verify "/etc/systemd/system/$api_unit" "/etc/systemd/system/$web_unit" > "$evidence/systemd-verify.log" 2>&1
sudo -n "$opt/tools/nginx" -e "$logs/nginx-bootstrap.log" -t -p "$run/" -c "$config/nginx.conf" > "$evidence/nginx-config.log" 2>&1
sudo -n systemctl daemon-reload
sudo -n systemctl start "$api_unit" "$web_unit"
wait_ready() {
  for ((attempt=0; attempt<50; attempt++)); do
    sudo -n systemctl is-active --quiet "$api_unit" "$web_unit" || fail 'An owned native unit stopped before readiness.'
    if curl --noproxy '*' --silent --show-error --fail --cacert "$scratch/ca.pem" --connect-timeout 1 --max-time 2 "$origin/readyz" >/dev/null 2>&1; then return; fi
    sleep 0.2
  done
  fail 'Verified HTTPS readiness did not pass.'
}
wait_ready
sudo -n systemctl show "$api_unit" -p User -p NoNewPrivileges -p PrivateTmp -p ProtectSystem -p ProtectHome -p CapabilityBoundingSet -p MainPID > "$evidence/api-properties.txt"
grep -Fxq 'NoNewPrivileges=yes' "$evidence/api-properties.txt" && grep -Fxq 'ProtectSystem=strict' "$evidence/api-properties.txt" || fail 'API hardening properties were not active.'
sudo -n -u "$api_user" test -r "$config/secrets/session"
if sudo -n -u "$api_user" test -w "$opt/current/bin/aster-api" || sudo -n -u "$api_user" test -w "$config/secrets/session" || sudo -n -u "$api_user" test -r "$scratch/migrator.dsn"; then fail 'Runtime OS identity can modify releases/secrets or read migration credentials.'; fi
actual_pid=$(sudo -n systemctl show "$api_unit" -p MainPID --value)
[[ $(ps -o user= -p "$actual_pid" | xargs) == "$api_user" ]] || fail 'API did not run as its dedicated non-root account.'
python3 "$project/deploy/ci/accept-native-http.py" --project "$project" --port "$tls_port" --http-port "$http_port" --ca "$scratch/ca.pem" --accounts "$scratch/accounts.json" --report "$evidence/https-tests.json"

step 'API restart and same-schema versioned symlink upgrade/rollback'
count_before=$("${mysql_cmd[@]}" "$db" --execute='SELECT COUNT(*) FROM orders')
[[ $count_before =~ ^[0-9]+$ && $count_before -gt 0 ]] || fail 'Business suite did not persist orders.'
for version in b a; do
  sudo -n systemctl stop "$api_unit"
  [[ ! -e $opt/current.next && -L $opt/current ]] || fail 'Unexpected release link state.'
  sudo -n ln -s "$opt/releases/$version" "$opt/current.next"
  sudo -n mv -T "$opt/current.next" "$opt/current"
  sudo -n systemctl start "$api_unit"
  wait_ready
  [[ $(curl --noproxy '*' --silent --show-error --fail --cacert "$scratch/ca.pem" "$origin/release-id.txt") == "$version" ]] || fail 'Nginx did not serve the selected version.'
  [[ $("${mysql_cmd[@]}" "$db" --execute='SELECT COUNT(*) FROM orders') == "$count_before" ]] || fail 'Order persistence changed across same-schema restart.'
done

step 'Real native logical backup, isolated empty-database restore and data comparison'
sudo -n systemctl stop "$api_unit"
mkdir -m 700 "$scratch/backups"
monotonic_ns() { python3 -c 'import time; print(time.monotonic_ns())'; }
backup_started=$(monotonic_ns)
PATH="$mysql_root/bin:$PATH" bash "$project/deploy/scripts/backup-native.sh" --client-config "$scratch/backup.cnf" --socket "$mysql_socket" --database "$db" --output-dir "$scratch/backups" > "$scratch/backup.log"
mapfile -t archives < <(find "$scratch/backups" -type f -name database.sql.gz)
[[ ${#archives[@]} == 1 ]] || fail 'Backup did not publish exactly one complete archive.'
backup_dir=$(dirname -- "${archives[0]}")
(cd "$backup_dir" && sha256sum --check --status SHA256SUMS && gzip -t database.sql.gz)
backup_finished=$(monotonic_ns)
[[ $("${mysql_cmd[@]}" "$restored" --execute='SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()') == 0 ]] || fail 'Restore target is not empty.'
restore_started=$(monotonic_ns)
gzip -dc "${archives[0]}" | "$mysql_root/bin/mysql" "--defaults-file=$scratch/restore.cnf" --no-login-paths --protocol=SOCKET "--socket=$mysql_socket" "$restored" > "$scratch/restore.log" 2>&1
restore_finished=$(monotonic_ns)
source_tables=$("${mysql_cmd[@]}" "$db" --execute='SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()')
restored_tables=$("${mysql_cmd[@]}" "$restored" --execute='SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()')
[[ $source_tables =~ ^[0-9]+$ && $source_tables -gt 0 && $restored_tables == "$source_tables" ]] || fail 'Restored table count does not match the nonempty source schema.'
for target in "$db" "$restored"; do
  "$mysql_root/bin/mysqldump" "--defaults-file=$admin_cnf" --no-login-paths --protocol=SOCKET "--socket=$mysql_socket" --single-transaction --no-tablespaces --set-gtid-purged=OFF --no-create-info --skip-comments --compact --skip-extended-insert --order-by-primary --skip-triggers "$target" 2> "$scratch/compare.log" | sha256sum | cut -d' ' -f1 > "$scratch/$target.sha256"
done
cmp "$scratch/$db.sha256" "$scratch/$restored.sha256" || fail 'Restored table data differs from the stopped source database.'
sudo -n install -o root -g "$api_user" -m 640 "$scratch/restore_runtime.service.dsn" "$config/secrets/runtime.service.dsn"
sudo -n systemctl start "$api_unit"
wait_ready
python3 "$project/deploy/ci/accept-native-http.py" --project "$project" --port "$tls_port" --http-port "$http_port" --ca "$scratch/ca.pem" --accounts "$scratch/accounts.json" --report "$evidence/restored-https-tests.json"
python3 - "$evidence" "$source_root" "$count_before" "$source_tables" "$restored_tables" "$backup_started" "$backup_finished" "$restore_started" "$restore_finished" <<'PY'
import json
from pathlib import Path
import subprocess
import sys
out, source, count, source_tables, restored_tables, backup_started, backup_finished, restore_started, restore_finished = sys.argv[1:]
summary = {
    'source_commit': subprocess.check_output(['git','-C',source,'rev-parse','HEAD'],text=True).strip(),
    'environment': 'isolated Ubuntu 24.04 GitHub-hosted runner',
    'systemd_hardened_api': True, 'nginx_verified_tls': True,
    'runtime_dml_migrator_separation': True, 'native_backup_restore_equal_data': True,
    'same_schema_release_a_b_a': True, 'persisted_orders_before_restart': int(count),
    'source_table_count': int(source_tables), 'restored_table_count': int(restored_tables),
    'backup_elapsed_seconds': round((int(backup_finished) - int(backup_started)) / 1e9, 3),
    'restore_import_elapsed_seconds': round((int(restore_finished) - int(restore_started)) / 1e9, 3),
    'timing_scope': 'isolated small-fixture exercise; backup includes archive verification, restore measures SQL import only',
    'production_rto_rpo_validated': False,
    'database_process_restart': False, 'machine_reboot': False,
    'browser_visual_qa': False, 'production_deployment': False,
    'paid_services_or_real_providers': False,
    'fixture_socket_mapping': 'single readonly systemd bind mount into private /run path',
}
Path(out,'native-acceptance.json').write_text(json.dumps(summary,ensure_ascii=False,sort_keys=True,indent=2)+'\n')
print('NATIVE_ACCEPTANCE_JSON=' + json.dumps(summary, ensure_ascii=False, sort_keys=True))
PY
step 'Passed; cleaning only owned test services, accounts, databases and paths'
