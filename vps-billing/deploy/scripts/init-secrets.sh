#!/bin/sh
# Creates local secret files only. Does not connect or deploy anywhere.
set -eu
cd "$(dirname "$0")/.."
command -v openssl >/dev/null || { echo 'openssl is required' >&2; exit 1; }
[ ! -e secrets ] || { echo 'Refusing to overwrite existing secrets directory' >&2; exit 1; }
umask 077
mkdir secrets
chmod 700 secrets
openssl rand -hex 32 > secrets/session_secret
openssl rand -hex 32 > secrets/mysql_password
openssl rand -hex 32 > secrets/mysql_runtime_password
openssl rand -hex 32 > secrets/mysql_root_password
openssl rand -base64 36 > secrets/bootstrap_password
printf 'aster_runtime:%s@tcp(db:3306)/aster?parseTime=true&charset=utf8mb4&loc=UTC\n' "$(cat secrets/mysql_runtime_password)" > secrets/mysql_dsn
printf 'aster_migrator:%s@tcp(db:3306)/aster?parseTime=true&charset=utf8mb4&loc=UTC\n' "$(cat secrets/mysql_password)" > secrets/mysql_migration_dsn
# Compose file-backed secrets retain host permissions. 0444 allows nonroot
# containers to read them; the 0700 parent directory protects host traversal.
chmod 444 secrets/*
printf '%s\n' 'Created secrets under a private 0700 directory. Keep this directory private and encrypted at rest.'
printf '%s\n' 'Bootstrap password is in secrets/bootstrap_password. Do not paste it into chat or logs.'
