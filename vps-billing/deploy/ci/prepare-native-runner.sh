#!/usr/bin/env bash
# Provision libraries in an explicitly disposable GitHub-hosted Ubuntu runner.
# Database/Nginx packages are never installed as host services by this script.
set +x
set -euo pipefail
umask 077

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
[[ $# == 0 ]] || fail 'This runner preparation takes no arguments.'
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted ]] \
  || fail 'Only an ephemeral GitHub-hosted runner is supported.'
[[ $EUID != 0 && $(uname -m) == x86_64 ]] || fail 'Use the unprivileged Linux amd64 runner account.'
[[ -f /etc/os-release ]] || fail 'Missing OS identity.'
. /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]] || fail 'Only Ubuntu 24.04 is supported.'
[[ -n ${GITHUB_ENV:-} && -f $GITHUB_ENV && -w $GITHUB_ENV ]] || fail 'Missing job environment output.'
for command in sudo apt-get dpkg-deb sha256sum; do
  command -v "$command" >/dev/null || fail "Missing $command."
done

# The hosted image may make its installed Chrome tree shared-writable. Verify
# protected dpkg records and remove only those write bits before any browser use.
# This does not install Chrome, restore set-ID bits, or change sandbox policy.
controller_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
sudo env GITHUB_ACTIONS=true RUNNER_ENVIRONMENT=github-hosted \
  /usr/bin/python3 -I "$controller_dir/prepare-browser.py"

# /run is visible to the hardened API; PrivateTmp and ProtectHome intentionally
# hide ordinary temporary/home directories. Never reuse an existing path.
fixture_root=$(sudo mktemp -d /run/aster-native.XXXXXXXX)
[[ $fixture_root =~ ^/run/aster-native\.[A-Za-z0-9]{8}$ ]] || fail 'Unexpected scratch path.'
sudo chown -- "$(id -u):$(id -g)" "$fixture_root"
printf 'ASTER_NATIVE_FIXTURE_ROOT=%s\n' "$fixture_root" >>"$GITHUB_ENV"
mkdir "$fixture_root/packages" "$fixture_root/nginx"

apt_security=(-o Acquire::Retries=0 -o APT::Get::AllowUnauthenticated=false
  -o Acquire::AllowInsecureRepositories=false -o Acquire::AllowDowngradeToInsecureRepositories=false)
sudo apt-get "${apt_security[@]}" update
# These are runtime libraries/tools and browser-test fonts only. Do not install or upgrade MySQL or
# Nginx services, change repositories, disable signature checks or run a daemon.
sudo env DEBIAN_FRONTEND=noninteractive apt-get "${apt_security[@]}" install --yes --no-install-recommends \
  libaio1t64 libmecab2 libnuma1 libssl3t64 libtirpc3t64 libtinfo6 \
  libgssapi-krb5-2 libkrb5-3 libsasl2-2 libudev1 libpcre2-8-0 openssl fonts-noto-cjk
(
  cd "$fixture_root/packages"
  apt-get "${apt_security[@]}" download nginx
)
shopt -s nullglob
packages=("$fixture_root/packages/"*.deb)
[[ ${#packages[@]} == 1 ]] || fail 'Expected one authenticated Ubuntu nginx package.'
package=${packages[0]}
[[ $(dpkg-deb --field "$package" Package) == nginx ]] || fail 'Unexpected Nginx package identity.'
[[ $(dpkg-deb --field "$package" Architecture) == amd64 ]] || fail 'Unexpected Nginx package architecture.'
dpkg-deb --extract "$package" "$fixture_root/nginx"
nginx_binary="$fixture_root/nginx/usr/sbin/nginx"
[[ -f $nginx_binary && ! -L $nginx_binary && -x $nginx_binary ]] || fail 'Nginx executable missing.'
"$nginx_binary" -v
sha256sum "$package"
printf 'ASTER_ACCEPT_NGINX_BIN=%s\n' "$nginx_binary" >>"$GITHUB_ENV"
printf 'PASS: authenticated Ubuntu libraries and isolated Nginx executable prepared.\n'

# Exercise the actual host's typed systemd properties before the long database
# suites. These two root-owned fixtures are loaded for inspection, never started.
# The source module is imported only by the ordinary runner Python interpreter.
python3 -I - "$controller_dir/../scripts/core-operation.py" "$fixture_root" <<'PYHOOKSMOKE'
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile

def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)

def run(arguments, allowed=(0,)):
    result = subprocess.run(arguments, cwd='/', stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20)
    require(result.returncode in allowed and len(result.stdout) <= 16384, 'fixed_smoke_command_failed')
    return result.stdout

require(os.geteuid() != 0 and os.environ.get('GITHUB_ACTIONS') == 'true' and
        os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted' and
        os.environ.get('GITHUB_REPOSITORY') == 'xiaoqiqixi/betteridcsys', 'isolated_runner_required')
identity = os.environ.get('GITHUB_RUN_ID', '') + '-' + os.environ.get('GITHUB_RUN_ATTEMPT', '')
require(re.fullmatch(r'[0-9]+-[0-9]+', identity) is not None, 'run_identity_required')
source = Path(sys.argv[1]).resolve()
spec = importlib.util.spec_from_file_location('native_prepare_hook_smoke', source)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
diagnostics = {'calls': [], 'last_call': 'not-started', 'rejection': 'none'}
def safe_reply_shape(raw, call, unit):
    report = {'json_valid': False}
    if len(raw) > 8192:
        report['exceeded_json_bound'] = True
        return report
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError):
        return report
    report['json_valid'] = True
    report['object'] = isinstance(value, dict)
    if not isinstance(value, dict):
        return report
    report['type_key_present'] = 'type' in value
    report['data_key_present'] = 'data' in value
    report['keys_exact'] = set(value) == {'type', 'data'}
    kind = value.get('type')
    report['type_is_string'] = isinstance(kind, str)
    report['type'] = kind if kind in ('s', 'a(sasbttttuii)', 'v') else 'other_or_absent'
    data = value.get('data')
    report['data_kind'] = 'list' if isinstance(data, list) else 'string' if isinstance(data, str) else 'object' if isinstance(data, dict) else 'other_or_absent'
    if isinstance(data, list):
        report['list_length'] = min(len(data), 10000)
        if len(data) == 1 and isinstance(data[0], list):
            report['nested_single_list_length'] = min(len(data[0]), 10000)
    if call == 'unit-id':
        report['identity_matches'] = data == unit
    return report

class ObservedNative(module.Native):
    def run(self, argv, env=None, data=None, timeout=90, allow_failure=False, identity=None):
        call = 'unit-id' if argv[-1] == 'Id' else argv[-1] if argv[-1] in module.SERVICE_HOOKS else 'other-fixed-native-call'
        diagnostics['last_call'] = call
        result = super().run(argv, env=env, data=data, timeout=timeout, allow_failure=True, identity=identity)
        diagnostics['calls'] = (diagnostics['calls'] + [{
            'call': call, 'exit_code': result.returncode if -255 <= result.returncode <= 255 else None,
            'shape': safe_reply_shape(result.stdout, call, self.spec['api_unit'])}])[-16:]
        module.require(allow_failure or result.returncode == 0, 'A fixed native operation failed; raw diagnostics were suppressed.')
        return result

try:
    info = Path('/usr/bin/busctl').lstat()
    diagnostics['busctl_metadata'] = {'uid': info.st_uid, 'gid': info.st_gid,
        'mode': oct(stat.S_IMODE(info.st_mode)), 'nlink': info.st_nlink,
        'regular_file': stat.S_ISREG(info.st_mode)}
except OSError:
    diagnostics['busctl_metadata_unavailable'] = True
units = [Path('/run/systemd/system') / ('aster-property-ci-' + identity + suffix + '.service')
         for suffix in ('-empty', '-hook')]
require(all(not os.path.lexists(path) for path in units), 'refuse_existing_smoke_units')
created = []
passed = False
empty_verified = 0
rejected = False
cleanup_ok = False
phase = 'install-owned-units'
try:
    with tempfile.TemporaryDirectory(prefix='aster-property-', dir=sys.argv[2]) as scratch:
        for number, target in enumerate(units):
            text = '[Unit]\nDescription=Aster isolated property inspection\n[Service]\nType=oneshot\n'
            if number:
                text += 'ExecStartPre=/usr/bin/true\n'
            text += 'ExecStart=/usr/bin/true\n'
            local = Path(scratch) / target.name
            local.write_text(text)
            created.append((target, text.encode()))
            run(['sudo', '-n', '/usr/bin/install', '-o', 'root', '-g', 'root', '-m', '644', str(local), str(target)])
            info = target.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0 and
                    stat.S_IMODE(info.st_mode) == 0o644 and info.st_nlink == 1 and target.read_bytes() == text.encode(),
                    'smoke_unit_metadata_mismatch')
        run(['sudo', '-n', '/usr/bin/systemctl', 'daemon-reload'])
        def inactive(target):
            # Read fixture state without starting it; typed properties load metadata independently.
            raw = run(['/usr/bin/systemctl', 'show', '--all', target.name,
                       '--property=LoadState', '--property=ActiveState', '--property=MainPID'])
            values = dict(line.split('=', 1) for line in raw.decode('ascii').splitlines() if '=' in line)
            require(values == {'LoadState': 'loaded', 'ActiveState': 'inactive', 'MainPID': '0'},
                    'smoke_fixture_not_inactive')
        for target in units:
            inactive(target)
        expected = set(module.SERVICE_HOOKS)
        phase = 'verify-empty-typed-hooks'
        observed = ObservedNative({'api_unit': units[0].name}).verify_empty_service_hooks()
        require(isinstance(observed, dict) and set(observed) == expected and all(value is True for value in observed.values()),
                'actual_empty_typed_hook_properties_not_verified')
        empty_verified = len(expected)
        phase = 'reject-nonempty-typed-hook'
        try:
            ObservedNative({'api_unit': units[1].name}).verify_empty_service_hooks()
        except module.Rejected as failure:
            last = diagnostics['calls'][-1] if diagnostics['calls'] else {}
            shape = last.get('shape', {})
            rejected = (str(failure) == 'Typed systemd service hooks are missing, nonempty or malformed.' and
                        last.get('call') == 'ExecStartPre' and last.get('exit_code') == 0 and
                        shape.get('type') == 'a(sasbttttuii)' and shape.get('data_kind') == 'list' and
                        shape.get('list_length', 0) > 0)
        require(rejected, 'actual_nonempty_typed_hook_was_accepted')
        for target in units:
            inactive(target)
        passed = True
        phase = 'complete'
except Exception as failure:
    # Only the bounded phase/result below is public, never exception bodies.
    diagnostics['rejection'] = {
        'A fixed native operation failed; raw diagnostics were suppressed.': 'fixed_native_command_failed',
        'Typed systemd unit identity does not match the reviewed service.': 'unit_identity_shape_or_value_mismatch',
        'Typed systemd service hooks are missing, nonempty or malformed.': 'hook_array_missing_nonempty_or_malformed',
    }.get(str(failure), 'other_fixed_or_suppressed_failure')
finally:
    # Only the two newly installed fixed-text paths are eligible for removal.
    cleanup_failures = 0
    for target, expected in created:
        try:
            if os.path.lexists(target):
                info = target.lstat()
                require(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0 and
                        stat.S_IMODE(info.st_mode) == 0o644 and info.st_nlink == 1 and
                        info.st_size == len(expected) and target.read_bytes() == expected,
                        'smoke_cleanup_refuses_changed_unit')
                run(['sudo', '-n', '/usr/bin/rm', '--', str(target)])
        except Exception:
            cleanup_failures += 1
    if created:
        try:
            run(['sudo', '-n', '/usr/bin/systemctl', 'daemon-reload'])
        except Exception:
            cleanup_failures += 1
    cleanup_ok = cleanup_failures == 0 and all(not os.path.lexists(target) for target, _ in created)
    print('NATIVE_SERVICE_HOOK_SMOKE_JSON=' + json.dumps({
        'passed': passed and cleanup_ok, 'phase': phase,
        'typed_empty_hook_properties_verified': empty_verified,
        'nonempty_hook_rejected': rejected, 'fixture_services_started': False,
        'owned_unit_files_removed': cleanup_ok, 'diagnostics': diagnostics}, sort_keys=True), flush=True)
    require(cleanup_ok, 'owned_smoke_fixture_cleanup_failed')
require(passed, 'actual_service_hook_smoke_failed')
PYHOOKSMOKE
