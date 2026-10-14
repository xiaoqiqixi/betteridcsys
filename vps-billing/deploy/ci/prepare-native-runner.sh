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
