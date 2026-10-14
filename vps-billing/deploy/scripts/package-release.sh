#!/usr/bin/env bash
# Build a reviewed Git commit, never the working tree. No publication or deployment.
set -euo pipefail
umask 022
export LC_ALL=C TZ=UTC GOENV=off GOFLAGS= GOWORK=off GOTOOLCHAIN=local

usage() {
  echo 'Usage: package-release.sh --commit COMMIT --version LABEL --output NEW_DIRECTORY' >&2
  echo 'Requires Git, GNU tar, gzip, sha256sum, Python 3, Go, Node.js and npm. Output must be outside the repository.' >&2
}
commit_ref= version= output=
while (($#)); do
  case "$1" in
    --commit|--version|--output)
      (($# >= 2)) || { usage; exit 2; }
      case "$1" in --commit) commit_ref=$2;; --version) version=$2;; --output) output=$2;; esac
      shift 2 ;;
    *) usage; exit 2 ;;
  esac
done
[[ -n "$commit_ref" && -n "$version" && -n "$output" ]] || { usage; exit 2; }
[[ "$version" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$ ]] || { echo 'Invalid release label' >&2; exit 2; }
for tool in git tar gzip sha256sum python3 go node npm; do
  command -v "$tool" >/dev/null || { echo "Required tool missing: $tool" >&2; exit 1; }
done
tar --version | head -1 | grep -q 'GNU tar' || { echo 'GNU tar is required' >&2; exit 1; }
script_dir=$(cd "$(dirname "$0")" && pwd -P)
repo=$(git -C "$script_dir" rev-parse --show-toplevel)
commit=$(git -C "$repo" rev-parse --verify "${commit_ref}^{commit}")
epoch=$(git -C "$repo" show -s --format=%ct "$commit")
export SOURCE_DATE_EPOCH="$epoch"
output=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$output")
[[ "$output" != "$repo" && "$output" != "$repo/"* ]] || { echo 'Output must be outside the repository' >&2; exit 1; }
[[ ! -e "$output" ]] || { echo 'Refusing to overwrite output directory' >&2; exit 1; }
# Prevent running an unrecorded packaging recipe against an older source commit.
for recipe in package-release.sh release-manifest.py; do
  git -C "$repo" show "$commit:vps-billing/deploy/scripts/$recipe" | cmp -s - "$script_dir/$recipe" || {
    echo "Packaging recipe differs from selected commit: $recipe" >&2; exit 1;
  }
done
tmp=$(mktemp -d "${TMPDIR:-/tmp}/aster-release.XXXXXXXX")
trap 'rm -rf "$tmp"' EXIT
snapshot="$tmp/source"
mkdir -p "$snapshot"
git -C "$repo" archive "$commit" -- LICENSE README.md vps-billing | tar -xf - -C "$snapshot"
python3 "$script_dir/release-manifest.py" prune "$snapshot"
build="$snapshot/vps-billing"
bundle_name="aster-${version}-linux-amd64"
bundle="$tmp/$bundle_name"
mkdir -p "$bundle/bin" "$bundle/web" "$bundle/manifests" "$bundle/licenses"
(
  cd "$build/backend"
  # GOENV/GOFLAGS/GOWORK overrides cannot silently alter release inputs.
  export GOENV=off GOFLAGS= GOWORK=off GOTOOLCHAIN=local
  go mod download
  go mod verify
  go list -mod=readonly -m -json all > "$tmp/go-modules.json"
  CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -mod=readonly -trimpath -buildvcs=false -ldflags='-s -w' -o "$bundle/bin/aster-api" ./cmd/server
  go version -m "$bundle/bin/aster-api" > "$tmp/go-build.txt"
)
(
  cd "$build/frontend"
  # All dependency versions/integrity hashes come from package-lock.json.
  npm ci --no-audit --no-fund
  npm run build
)
cp -R "$build/frontend/dist/." "$bundle/web/"
cp -R "$build/docs" "$bundle/docs"
cp -R "$build/deploy" "$bundle/deploy"
cp "$snapshot/LICENSE" "$bundle/LICENSE"
cp "$snapshot/README.md" "$bundle/REPOSITORY-README.md"
cp "$build/README.md" "$bundle/PROJECT-README.md"
cp "$build/backend/go.mod" "$build/backend/go.sum" "$bundle/manifests/"
cp "$build/frontend/package.json" "$build/frontend/package-lock.json" "$bundle/manifests/"
python3 "$script_dir/release-manifest.py" manifest "$snapshot" "$bundle" "$tmp/go-modules.json" "$tmp/go-build.txt" "$commit" "$version" "$epoch"
# npm build output and dependencies are not part of the source archive.
python3 "$script_dir/release-manifest.py" prune "$snapshot"
find "$snapshot" "$bundle" -type d -exec chmod 755 {} +
find "$snapshot" "$bundle" -type f -exec chmod 644 {} +
find "$snapshot/vps-billing/deploy/scripts" "$bundle/deploy/scripts" -type f -name '*.sh' -exec chmod 755 {} +
chmod 755 "$bundle/bin/aster-api"
mkdir -p "$(dirname "$output")"
publish=$(mktemp -d "$(dirname "$output")/.aster-package.XXXXXXXX")
trap 'rm -rf "$tmp" "$publish"' EXIT
tar --sort=name --mtime="@$epoch" --owner=0 --group=0 --numeric-owner --format=gnu -C "$tmp" -cf - "$bundle_name" | gzip -n > "$publish/$bundle_name.tar.gz"
source_name="aster-${version}-source"
mv "$snapshot" "$tmp/$source_name"
tar --sort=name --mtime="@$epoch" --owner=0 --group=0 --numeric-owner --format=gnu -C "$tmp" -cf - "$source_name" | gzip -n > "$publish/$source_name.tar.gz"
cp "$bundle/manifests/BUILD.json" "$publish/BUILD.json"
(
  cd "$publish"
  sha256sum BUILD.json ./*.tar.gz > SHA256SUMS
  sha256sum -c SHA256SUMS
)
mv -T "$publish" "$output"
echo "Release files: $output"
echo "Source commit: $commit (publication and deployment were not performed)"
