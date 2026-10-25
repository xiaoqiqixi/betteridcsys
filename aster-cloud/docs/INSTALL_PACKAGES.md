# Independent cloud development packages

These are **development candidates**, not a formal Release or proof that native
installation, a real KVM guest, networking, upgrade or recovery has passed.
The financial Core `v0.5.9` assets and installer are not cloud packages.
Only `0.x.y-dev` and `0.x.y-dev.n` versions are accepted, matching the independent
installer's development-candidate policy.

## Build from one reviewed commit

From a clean monorepo, with Python 3.9+, Git, Go (toolchain `go1.27.3`) and
Node `24.19.0` / npm available on `PATH`:

```sh
python3 /absolute/path/to/betteridcsys/aster-cloud/deploy/scripts/package-cloud.py \
  --source-root /absolute/path/to/betteridcsys \
  --source-commit FULL_40_LOWERCASE_HEX_COMMIT \
  --version 0.1.0-dev \
  --output /absolute/path/outside-the-repository/cloud-candidate
```

The full commit must exist locally. Tracked edits, staged edits and nonignored
untracked files are refused; there is no dirty-source bypass. Ignored build caches
are never copied. The builder safely extracts **Git objects at that exact SHA**,
not the current worktree or whatever a branch name resolves to later. The SHA can
be older than a clean `HEAD`; the manifest always names the requested source.

The production path cross-compiles three real `CGO_ENABLED=0` Linux amd64 Go
executables, runs `npm ci --ignore-scripts --no-audit --no-fund --include=dev` and the actual
frontend `npm run build`. It neither accepts prebuilt binary/UI directories nor
offers a fake-build CLI option. It may download the pinned Go toolchain and locked
Go/npm dependencies, so builds require approved network access or populated
caches. Ambient Go flags/experiments and `VITE_*` variables are excluded from the
build configuration; the amd64 instruction baseline is pinned to `GOAMD64=v1`.
It does not install host packages, services, databases or VM software.

The public `controllerapi` contract currently resolves through the adjacent
financial Go module and its `internal/controllers` wrappers. Those reviewed source
dependencies come from the **same monorepo SHA** during compilation. No financial
Release archive, executable, installer, configuration, database or secret is
copied. The resulting static cloud binaries do not require the financial directory
at runtime. This is not yet a separately published public-contract module.

## Output and installer contract

Exactly two archives and an external checksum file are published:

```text
aster-cloud-controller-0.1.0-dev-linux-amd64.tar.gz
aster-cloud-node-0.1.0-dev-linux-amd64.tar.gz
SHA256SUMS
```

Each tar contains only regular files, with **no enclosing directory**, symlinks,
hardlinks, devices, FIFOs, absolute paths or `..`. No explicit directory members
are emitted. File names are canonical POSIX paths. Archive owner/group are zero,
names empty, modes normalized, timestamp fixed to the source commit; gzip headers
omit temporary paths. Running the same build twice with the same dependencies
should produce identical output; a release gate must actually compare the bytes
rather than assume this property.

Common prefixes: `manifest.json`, `bin/`, `templates/`, `licenses/`, `docs/`.
The controller also contains **compiled** `ui/index.html` and `ui/assets/...`.
The node package has no UI or npm dependency notices.

- Controller binary: `bin/aster-controller`.
- Node binaries: `bin/aster-node`, `bin/aster-network`.
- Templates retain their reviewed source names, such as
  `templates/controller-aster.service`, `templates/node-aster-node.service` and
  `templates/node-config.example.json`. They are review material, not permission
  for an installer to execute archive-provided scripts or activate example policy.
- Licenses include the project license, Go standard library and external module
  notices; the controller includes frontend dependency notices.
- No credentials, databases, VM images, journals, source checkout or `node_modules`
  implementation files are packaged.

Required manifest schema:

```json
{
  "schema": 1,
  "component": "aster-cloud-controller",
  "version": "0.1.0-dev",
  "source_commit": "0123456789abcdef0123456789abcdef01234567",
  "platform": "linux-amd64",
  "release_kind": "development",
  "files": [
    {"path": "bin/aster-controller", "sha256": "64_lowercase_hex", "size": 123, "mode": "0755"}
  ]
}
```

Node `component` is `aster-cloud-node`. `files` is sorted by path and lists
**every non-manifest member exactly once**. `manifest.json` cannot self-hash and
is excluded from that list. Mode is an exact four-digit octal **string**: `0755`
only for binaries and `0644` for other content. Additional metadata records
`role`, source-declared `protocols`, supported `data_schemas` and pinned `build`
tool versions. Schema/protocol metadata describes compatibility, not deployment
approval or a guarantee that all features were acceptance-tested.

`SHA256SUMS` uses the standard `64hex␠␠archive-name` format and hashes both complete
archives, including their manifests. It is a checksum, **not an authenticated
signature or provenance attestation**. An installer must receive a checksum from
an operator-approved source; downloading an archive and its checksum from the
same compromised location is not an independent trust anchor. Packaging never
creates a tag, Release, signature, remote upload or production-readiness claim.

Existing candidate names are never overwritten. Build/validation errors publish
no archives; the checksum file is published last as the complete-set marker.
Incomplete output after interruption must be reviewed, not silently overwritten.

## Offline tests and remaining gates

```sh
python3 -B /absolute/path/to/betteridcsys/aster-cloud/deploy/scripts/test_cloud_package.py
```

Tests inject a Python build callback into private temporary repositories; tiny
ELF-shaped **test fixtures are not executable production binaries**. Tests cover
manifest/installer compatibility, exact SHA snapshots, dirty-source refusal,
deterministic archive serialization, output conflicts, static ELF checks,
missing UI, links/special files and canonical paths. There is no test callback
option in the packaging CLI.

These tests do not replace a real pinned Go/npm build, two-build reproducibility
comparison, dependency/security scans, strict native TLS/MySQL/systemd installation
and rollback acceptance, or later dedicated KVM host acceptance. In particular,
the existing 1 GB financial server must not be used as a new KVM installation
target merely because a node archive can be built.
