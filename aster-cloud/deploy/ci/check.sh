#!/usr/bin/env bash
# Called only inside the existing disposable native-MySQL fixture.
set +x
set -euo pipefail
umask 077
[[ -n ${ASTER_MYSQL_TEST_DSN:-} || -n ${ASTER_CLOUD_TEST_DSN:-} ]] || { echo 'A disposable MySQL test DSN is required.' >&2; exit 1; }
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
cd "$repo"
scratch=$(mktemp -d "${RUNNER_TEMP:-/tmp}/aster-cloud-check.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
# No credential is echoed. SQL fixtures accept only explicitly named test DBs.
go test -mod=readonly -race -count=1 -v -timeout=10m ./... | tee "$scratch/tests.log"
if grep -q -- '--- SKIP:' "$scratch/tests.log"; then
  echo 'MySQL acceptance must not skip any test.' >&2; exit 1
fi
go vet -mod=readonly ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -mod=readonly -trimpath -buildvcs=false -o "$scratch/aster-controller" ./cmd/aster-controller
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -mod=readonly -trimpath -buildvcs=false -o "$scratch/aster-node" ./cmd/aster-node
# These checks do not install libvirt, start a node daemon, or create a VM.
echo 'PASS: controller/node Go, real MySQL and static Linux builds; not a real KVM guest acceptance.'
