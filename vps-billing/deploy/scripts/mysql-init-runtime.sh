#!/bin/bash
# Official MySQL entrypoint executes this only for a fresh data volume.
# Never grant DDL permissions to the runtime user.
set -euo pipefail
password="$(cat /run/secrets/mysql_runtime_password)"
# Restrict interpolation to the initializer's generated 64-character hex secret.
[[ "$password" =~ ^[0-9a-f]{64}$ ]] || { echo 'Invalid runtime password file' >&2; exit 1; }
export MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
mysql --protocol=socket --user=root <<SQL
CREATE USER 'aster_runtime'@'%' IDENTIFIED BY '${password}';
GRANT SELECT, INSERT, UPDATE, DELETE ON aster.* TO 'aster_runtime'@'%';
SQL
unset MYSQL_PWD password
