#!/usr/bin/env python3
"""Fail-closed draft release gate. Standard library only; artifact bytes are never executed.

The publishing workflow must run this file from the trusted default-branch commit.
Build code and dependencies run in a separate job with read-only credentials.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import tarfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

REPOSITORY = "xiaoqiqixi/betteridcsys"
REPOSITORY_ID = 1418618420
BUILD_WORKFLOW = ".github/workflows/release-build.yml"
PUBLISH_WORKFLOW = ".github/workflows/release-publish.yml"
TRUSTED_PATHS = (
    BUILD_WORKFLOW,
    "vps-billing/deploy/ci/release_pipeline.py",
    "vps-billing/deploy/ci/check.sh",
    "vps-billing/deploy/ci/mysql-native.sh",
    "vps-billing/deploy/ci/mysql-distribution.json",
    "vps-billing/deploy/scripts/package-release.sh",
    "vps-billing/deploy/scripts/release-manifest.py",
)
MAX_ZIP = 256 * 1024 * 1024
MAX_TAR = 256 * 1024 * 1024
MAX_FILE = 64 * 1024 * 1024
MAX_JSON = 2 * 1024 * 1024
MAX_MEMBERS = 20000
SHA = re.compile(r"^[0-9a-f]{40}$")
HASH = re.compile(r"^[0-9a-f]{64}$")
NUMBER = r"(?:0|[1-9][0-9]*)"
TAG = re.compile(rf"^v{NUMBER}\.{NUMBER}\.{NUMBER}-(?:alpha|beta|rc)\.{NUMBER}$")
INPUT_PATHS = (
    "LICENSE", "README.md", "vps-billing/backend/go.mod",
    "vps-billing/backend/go.sum", "vps-billing/frontend/package.json",
    "vps-billing/frontend/package-lock.json",
)


class GuardError(Exception):
    pass


class APIError(GuardError):
    def __init__(self, status, message="GitHub request failed"):
        self.status = status
        super().__init__(f"{message} (HTTP {status})")


def require(condition, message):
    if not condition:
        raise GuardError(message)


def integer(value, name):
    require(type(value) is int and value > 0, f"Invalid {name}")
    return value


def sha(value):
    require(isinstance(value, str) and SHA.fullmatch(value), "Invalid commit/blob SHA")
    return value


def validate_tag(tag):
    require(isinstance(tag, str) and len(tag) <= 64 and TAG.fullmatch(tag),
            "Only vMAJOR.MINOR.PATCH-alpha|beta|rc.N tags are allowed")
    return tag[1:]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(data):
    require(isinstance(data, bytes) and len(data) <= MAX_JSON, "JSON exceeds limit")
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result
    def invalid_constant(_):
        raise GuardError("Non-finite JSON value")
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=invalid_constant)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise GuardError("Invalid JSON") from exc


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHub:
    """Fixed API/upload hosts, no mutation retries, no credential-bearing redirects."""
    def __init__(self, token):
        require(isinstance(token, str) and token and "\n" not in token, "GH_TOKEN is required")
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def _open(self, method, url, data=None, content_type=None, authenticated=True, limit=MAX_JSON):
        require(isinstance(url, str) and all(32 < ord(char) < 127 for char in url), "Unsafe GitHub URL characters")
        parsed = urllib.parse.urlsplit(url)
        require(parsed.scheme == "https" and not parsed.username and not parsed.password and
                not parsed.fragment and parsed.port in (None, 443), "Unsafe GitHub URL")
        if authenticated:
            require(parsed.hostname in {"api.github.com", "uploads.github.com"}, "Unsafe authenticated host")
        headers = {"User-Agent": "betteridcsys-release-guard", "Accept": "application/vnd.github+json",
                   "X-GitHub-Api-Version": "2022-11-28"}
        if authenticated:
            headers["Authorization"] = "Bearer " + self.token
        if content_type:
            headers["Content-Type"] = content_type
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=60) as response:
                raw = response.read(limit + 1)
                require(len(raw) <= limit, "GitHub response exceeds limit")
                return response.status, response.headers, raw
        except urllib.error.HTTPError as exc:
            if exc.code in (301, 302, 303, 307, 308):
                return exc.code, exc.headers, b""
            # Never expose response bodies, signed URLs, token strings or provider messages.
            raise APIError(exc.code) from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise GuardError("GitHub request outcome uncertain; no mutation was retried") from None

    def request(self, method, path, data=None, raw=None, content_type=None):
        require(path.startswith("/repos/" + REPOSITORY + "/") or path == "/repos/" + REPOSITORY,
                "API path outside the fixed repository")
        require("#" not in path and "\n" not in path and not path.startswith("//"), "Unsafe API path")
        require(method in {"GET", "POST"}, "Unsupported API method")
        require(method != "POST" or path == api_path("/releases"), "Only draft release creation is a permitted JSON mutation")
        payload = json_bytes(data) if data is not None else raw
        status, _, response = self._open(method, "https://api.github.com" + path, payload,
                                        "application/json" if data is not None else content_type)
        require(status == (201 if method == "POST" else 200), "Unexpected GitHub API response")
        return strict_json(response)

    def upload(self, release_id, name, data):
        integer(release_id, "release ID")
        require(isinstance(name, str) and "/" not in name and "\\" not in name, "Invalid asset name")
        path = f"/repos/{REPOSITORY}/releases/{release_id}/assets?name=" + urllib.parse.quote(name, safe="")
        status, _, raw = self._open("POST", "https://uploads.github.com" + path, data,
                                    "application/octet-stream")
        require(status == 201, "Unexpected asset upload response")
        return strict_json(raw)

    def download_artifact(self, artifact):
        artifact_id = integer(artifact["id"], "artifact ID")
        url = f"https://api.github.com/repos/{REPOSITORY}/actions/artifacts/{artifact_id}/zip"
        status, headers, raw = self._open("GET", url, limit=MAX_ZIP)
        if status == 302:
            url = headers.get("Location", "")
            parsed = urllib.parse.urlsplit(url)
            host = parsed.hostname or ""
            # The artifact service redirects to a signed storage URL. The token
            # is never forwarded. Reject further redirects and arbitrary hosts.
            require(host.endswith(".blob.core.windows.net") or host.endswith(".actions.githubusercontent.com"),
                    "Unrecognized signed artifact storage host")
            status, _, raw = self._open("GET", url, authenticated=False, limit=MAX_ZIP)
        require(status == 200, "Artifact download redirect/status rejected")
        verify_zip_digest(raw, artifact)
        return raw


def api_path(suffix=""):
    return "/repos/" + REPOSITORY + suffix


def repository(api):
    repo = api.request("GET", api_path())
    require(repo.get("id") == REPOSITORY_ID and repo.get("full_name") == REPOSITORY and
            repo.get("private") is False and repo.get("archived") is not True and
            repo.get("disabled") is not True, "Repository identity/visibility check failed")
    branch = repo.get("default_branch")
    require(isinstance(branch, str) and re.fullmatch(r"[A-Za-z0-9._/-]{1,200}", branch) and
            ".." not in branch and "//" not in branch, "Invalid default branch")
    return branch


def resolve_ref(api, ref):
    require(ref.startswith(("heads/", "tags/")), "Unsupported ref")
    response = api.request("GET", api_path("/git/ref/" + urllib.parse.quote(ref, safe="/")))
    require(response.get("ref") == "refs/" + ref, "Unexpected Git ref")
    obj = response.get("object", {})
    seen = set()
    for _ in range(8):
        value = sha(obj.get("sha"))
        require(value not in seen, "Cyclic annotated tag")
        seen.add(value)
        if obj.get("type") == "commit":
            return value
        require(obj.get("type") == "tag" and ref.startswith("tags/"), "Ref is not a commit")
        tagged = api.request("GET", api_path("/git/tags/" + value))
        require(tagged.get("sha") == value, "Unexpected annotated tag object")
        obj = tagged.get("object", {})
    raise GuardError("Annotated tag nesting exceeds limit")


def ancestor(api, source, default):
    response = api.request("GET", api_path(f"/compare/{sha(source)}...{sha(default)}"))
    require(response.get("status") in {"ahead", "identical"} and
            response.get("merge_base_commit", {}).get("sha") == source,
            "Release source is not an ancestor of the trusted default commit")


def trusted_blobs(api, commit):
    tree = api.request("GET", api_path("/git/trees/" + sha(commit) + "?recursive=1"))
    require(tree.get("truncated") is False and isinstance(tree.get("tree"), list), "Incomplete Git tree")
    found = {}
    for entry in tree["tree"]:
        path = entry.get("path")
        if path in TRUSTED_PATHS:
            require(path not in found and entry.get("type") == "blob" and
                    entry.get("mode") in {"100644", "100755"}, "Untrusted guard path type")
            found[path] = sha(entry.get("sha"))
    require(set(found) == set(TRUSTED_PATHS), "Trusted build policy files are missing")
    return found


def verify_source_archive(api, files, provenance):
    """Bind every retained source file to Git, independently of upstream manifests."""
    version = provenance["version"]
    source = tar_files(files[f"aster-{version}-source.tar.gz"], f"aster-{version}-source")
    tree = api.request("GET", api_path("/git/trees/" + sha(provenance["source_sha"]) + "?recursive=1"))
    require(tree.get("truncated") is False and isinstance(tree.get("tree"), list), "Incomplete source Git tree")
    pruned_directories = {".git", "node_modules", "dist", "bin", "artifacts", "secrets", "backups", "test-results", "playwright-report", "__pycache__"}
    expected = {}
    for entry in tree["tree"]:
        path = entry.get("path")
        if not isinstance(path, str) or not (path in {"LICENSE", "README.md"} or path.startswith("vps-billing/")):
            continue
        parts = path.split("/")
        name = parts[-1]
        if pruned_directories.intersection(parts[:-1]) or ((name.startswith(".env") and name != ".env.example") or
                name.endswith((".log", ".tsbuildinfo", ".sql.gz", "-results.txt", ".pyc"))):
            continue
        if entry.get("type") == "tree":
            continue
        require(entry.get("type") == "blob" and entry.get("mode") in {"100644", "100755"} and path not in expected,
                "Source contains links/submodules/duplicate Git paths")
        expected[path] = sha(entry.get("sha"))
    require(set(source) == set(expected), "Source archive differs from the exact retained Git file set")
    for path, value in source.items():
        git_hash = hashlib.sha1(b"blob " + str(len(value)).encode("ascii") + b"\0" + value).hexdigest()
        require(git_hash == expected[path], "Source file differs from the tagged Git blob: " + path)


def build_workflow(api):
    result = api.request("GET", api_path("/actions/workflows/release-build.yml"))
    require(result.get("path") == BUILD_WORKFLOW and result.get("state") == "active",
            "Unexpected or inactive build workflow")
    return integer(result.get("id"), "build workflow ID")


def validate_run(api, run_id, attempt, completed):
    run = api.request("GET", api_path(f"/actions/runs/{integer(run_id, 'run ID')}"))
    require(run.get("id") == run_id and run.get("run_attempt") == attempt and
            run.get("workflow_id") == build_workflow(api) and run.get("path") == BUILD_WORKFLOW,
            "Untrusted workflow run identity or attempt")
    for field in ("repository", "head_repository"):
        identity = run.get(field, {})
        require(identity.get("id") == REPOSITORY_ID and identity.get("full_name") == REPOSITORY,
                "Workflow run originated outside the fixed repository")
    require(run.get("event") in {"push", "workflow_dispatch"}, "Untrusted build event")
    sha(run.get("head_sha"))
    if completed:
        require(run.get("status") == "completed" and run.get("conclusion") == "success",
                "Build run did not complete successfully")
    else:
        require(run.get("status") in {"queued", "in_progress"}, "Build run is not active")
    return run


def environment_identity(env):
    require(env.get("GITHUB_REPOSITORY") == REPOSITORY and
            env.get("GITHUB_REPOSITORY_ID") == str(REPOSITORY_ID), "Environment repository mismatch")
    return integer(int(env.get("GITHUB_RUN_ID", "0")), "run ID"), integer(int(env.get("GITHUB_RUN_ATTEMPT", "0")), "run attempt")


def prepare_build(api, env, event):
    run_id, attempt = environment_identity(env)
    branch = repository(api)
    default = resolve_ref(api, "heads/" + branch)
    # This step executes before source/dependency code and needs contents:read
    # only. The publisher later verifies this claimed identity against Actions.
    event_name = env.get("GITHUB_EVENT_NAME")
    require(event_name in {"push", "workflow_dispatch"}, "Untrusted build event")
    run = {"event": event_name, "head_sha": sha(env.get("GITHUB_SHA"))}
    require(env.get("GITHUB_WORKFLOW_SHA") == run["head_sha"], "Build environment/workflow mismatch")
    if run["event"] == "push":
        ref = event.get("ref")
        require(isinstance(ref, str) and ref.startswith("refs/tags/") and env.get("GITHUB_REF") == ref and
                event.get("deleted") is False, "Build requires an existing tag push")
        tag = ref[len("refs/tags/"):]
    else:
        require(env.get("GITHUB_REF") == "refs/heads/" + branch and run["head_sha"] == default,
                "Manual builds must run from the current default branch")
        tag = event.get("inputs", {}).get("tag")
    version = validate_tag(tag)
    source = resolve_ref(api, "tags/" + tag)
    if run["event"] == "push":
        require(source == run["head_sha"], "Tag does not identify this build commit")
    ancestor(api, source, default)
    blobs = trusted_blobs(api, default)
    require(trusted_blobs(api, run["head_sha"]) == blobs and trusted_blobs(api, source) == blobs,
            "Build/source guard policy differs from the default branch")
    return {"schema": 1, "repository": REPOSITORY, "repository_id": REPOSITORY_ID,
            "run_id": run_id, "run_attempt": attempt, "event": run["event"],
            "tag": tag, "version": version, "source_sha": source,
            "run_head_sha": run["head_sha"], "workflow_sha": env["GITHUB_WORKFLOW_SHA"],
            "workflow_path": BUILD_WORKFLOW, "default_branch": branch, "default_sha": default,
            "trusted_blobs": blobs, "artifact_name": f"candidate-{run_id}-{attempt}"}


def package_files(version):
    return ("BUILD.json", f"aster-{version}-linux-amd64.tar.gz", f"aster-{version}-source.tar.gz", "SHA256SUMS")


def safe_path(name):
    require(isinstance(name, str) and name and len(name) <= 1024 and "\\" not in name and
            ":" not in name and not name.startswith("/") and not any(ord(c) < 32 or ord(c) == 127 for c in name),
            "Unsafe archive path")
    parts = name.rstrip("/").split("/")
    require(all(part not in {"", ".", ".."} for part in parts), "Archive path traversal/alias")
    forbidden = {".git", ".aws", ".ssh", "node_modules", "__pycache__", "secrets", "backups", "artifacts", "test-results", "playwright-report"}
    require(not forbidden.intersection(parts), "Forbidden local/secret directory in archive")
    basename = parts[-1].lower()
    require(not basename.endswith((".log", ".sql.gz", ".pyc", ".tsbuildinfo", "-results.txt", ".pem", ".key", ".p12", ".pfx")) and
            not (basename.startswith(".env") and basename != ".env.example") and
            not basename.endswith(".env"), "Forbidden secret/log file in archive")
    return parts


def scan_obvious_secrets(data):
    # A deliberately limited backstop, not a secret-scanning certification.
    require(not re.search(rb"(?m)^-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----\r?$", data) and
            not re.search(rb"\bgh[pousr]_[A-Za-z0-9]{30,}\b", data), "Private key/token material in artifact")


def tar_files(data, root):
    require(isinstance(data, bytes) and 0 < len(data) <= MAX_ZIP, "Invalid tar size")
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as zipped:
            decoded = zipped.read(MAX_TAR + 1)
        require(len(decoded) <= MAX_TAR, "Expanded tar exceeds limit")
        result = {}
        seen = set()
        total = 0
        with tarfile.open(fileobj=io.BytesIO(decoded), mode="r:") as archive:
            for item in archive:
                require(len(seen) < MAX_MEMBERS, "Too many tar members")
                parts = safe_path(item.name)
                require(parts[0] == root and item.name.rstrip("/") not in seen, "Unexpected/duplicate tar member")
                seen.add(item.name.rstrip("/"))
                require(item.isdir() or item.isfile(), "Archive links/devices are forbidden")
                require(not item.mode & 0o7000 and not item.linkname, "Archive special permission bits/link metadata")
                if item.isdir():
                    require(item.size == 0, "Directory archive payload is forbidden")
                    continue
                require(0 <= item.size <= MAX_FILE, "Tar file exceeds limit")
                total += item.size
                require(total <= MAX_TAR, "Tar payload exceeds limit")
                value = archive.extractfile(item).read(MAX_FILE + 1)
                require(len(value) == item.size, "Truncated tar file")
                scan_obvious_secrets(value)
                result["/".join(parts[1:])] = value
            require(not decoded[archive.offset:].strip(b"\0"), "Trailing tar payload")
        return result
    except (tarfile.TarError, OSError, EOFError, ValueError) as exc:
        raise GuardError("Invalid gzip/tar archive") from exc


def validate_package(files, source_sha, version):
    sha(source_sha)
    validate_tag("v" + version)
    require(set(files) == set(package_files(version)), "Release package must contain exactly four expected files")
    require(all(isinstance(value, bytes) and 0 < len(value) <= MAX_ZIP for value in files.values()), "Invalid package file size")
    sums = files["SHA256SUMS"]
    require(len(sums) <= 4096, "Checksum file exceeds limit")
    entries = {}
    try:
        for line in sums.decode("ascii").splitlines():
            match = re.fullmatch(r"([0-9a-f]{64})  (?:\./)?([A-Za-z0-9._-]+)", line)
            require(match is not None and match[2] not in entries, "Invalid/duplicate checksum entry")
            entries[match[2]] = match[1]
    except UnicodeError as exc:
        raise GuardError("Non-ASCII checksum file") from exc
    require(set(entries) == set(files) - {"SHA256SUMS"}, "Checksum inventory mismatch")
    require(all(sha256(files[name]) == digest for name, digest in entries.items()), "Package checksum mismatch")
    build = strict_json(files["BUILD.json"])
    require(isinstance(build, dict) and build.get("source_commit") == source_sha and
            build.get("release_label") == version and build.get("target") == "linux/amd64" and
            build.get("cgo_enabled") is False, "BUILD identity/target mismatch")
    bundle = tar_files(files[f"aster-{version}-linux-amd64.tar.gz"], f"aster-{version}-linux-amd64")
    source = tar_files(files[f"aster-{version}-source.tar.gz"], f"aster-{version}-source")
    require(bundle.get("manifests/BUILD.json") == files["BUILD.json"], "Nested BUILD manifest mismatch")
    require("web/index.html" in bundle and "LICENSE" in bundle, "Runtime bundle is incomplete")
    binary = bundle.get("bin/aster-api", b"")
    require(len(binary) >= 64 and binary[:6] == b"\x7fELF\x02\x01" and binary[18:20] == b"\x3e\x00",
            "Runtime binary is not Linux amd64 ELF64")
    inputs = build.get("input_sha256")
    require(isinstance(inputs, dict) and set(inputs) == set(INPUT_PATHS), "BUILD input inventory mismatch")
    for path in INPUT_PATHS:
        require(path in source and HASH.fullmatch(str(inputs[path])) and sha256(source[path]) == inputs[path],
                "Source input checksum mismatch")
    require(bundle["LICENSE"] == source["LICENSE"], "Root LICENSE differs across archives")
    for name, data in files.items():
        if not name.endswith(".tar.gz"):
            scan_obvious_secrets(data)
    return {name: {"sha256": sha256(data), "size": len(data)} for name, data in sorted(files.items())}


def seal_build(policy, directory):
    directory = Path(directory)
    require(directory.is_dir() and not directory.is_symlink(), "Invalid package directory")
    paths = list(directory.iterdir())
    require(all(path.is_file() and not path.is_symlink() for path in paths), "Package directory contains non-files")
    require(all(path.stat().st_size <= MAX_ZIP for path in paths), "Package file exceeds limit")
    files = {path.name: path.read_bytes() for path in paths}
    assets = validate_package(files, policy["source_sha"], policy["version"])
    provenance = dict(policy, assets=assets)
    with (directory / "PROVENANCE.json").open("xb") as stream:
        stream.write(json_bytes(provenance))
    return provenance


def read_artifact_zip(data):
    require(isinstance(data, bytes) and 0 < len(data) <= MAX_ZIP, "Invalid artifact ZIP size")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            members = archive.infolist()
            require(len(members) == 5, "Artifact ZIP must contain exactly five files")
            require(not archive.comment and data[-22:-18] == b"PK\x05\x06" and
                    min(item.header_offset for item in members) == 0,
                    "ZIP comments/prefix/trailing payload are forbidden")
            result = {}
            total = 0
            for member in members:
                parts = safe_path(member.filename)
                require(len(parts) == 1 and not member.is_dir() and member.filename not in result,
                        "Nested/duplicate ZIP path")
                require(not member.comment, "ZIP member comments are forbidden")
                mode = member.external_attr >> 16
                require(stat.S_IFMT(mode) in {0, stat.S_IFREG} and not mode & 0o7000 and not member.flag_bits & 1,
                        "ZIP links/special/encrypted files are forbidden")
                require(member.compress_type in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED} and
                        0 < member.file_size <= MAX_ZIP, "Invalid ZIP compression/size")
                total += member.file_size
                require(total <= MAX_ZIP, "Expanded ZIP exceeds limit")
                with archive.open(member) as stream:
                    value = stream.read(member.file_size + 1)
                require(len(value) == member.file_size, "Truncated ZIP entry")
                result[member.filename] = value
            require("PROVENANCE.json" in result, "Artifact provenance is missing")
            return result
    except (zipfile.BadZipFile, RuntimeError, OSError, ValueError) as exc:
        raise GuardError("Invalid artifact ZIP") from exc


def artifact_for_run(api, run_id, attempt):
    expected = f"candidate-{run_id}-{attempt}"
    matches = []
    for page in range(1, 101):
        response = api.request("GET", api_path(f"/actions/runs/{run_id}/artifacts?per_page=100&page={page}"))
        items = response.get("artifacts")
        require(isinstance(items, list) and len(items) <= 100, "Invalid artifact inventory")
        matches.extend(item for item in items if item.get("name") == expected)
        if len(items) < 100:
            break
    else:
        raise GuardError("Artifact inventory exceeds pagination limit")
    require(len(matches) == 1, "Missing/duplicate artifact for this run attempt")
    artifact = matches[0]
    integer(artifact.get("id"), "artifact ID")
    require(artifact.get("expired") is False and type(artifact.get("size_in_bytes")) is int and
            0 < artifact["size_in_bytes"] <= MAX_ZIP, "Artifact expired/oversized")
    require(re.fullmatch(r"sha256:[0-9a-f]{64}", str(artifact.get("digest", ""))), "Artifact SHA-256 digest is required")
    linked = artifact.get("workflow_run", {})
    require(linked.get("id") == run_id and linked.get("repository_id") == REPOSITORY_ID and
            linked.get("head_repository_id") == REPOSITORY_ID, "Artifact/run repository mismatch")
    return artifact


def prepare_publish(api, env, event):
    environment_identity(env)
    require(env.get("GITHUB_EVENT_NAME") == "workflow_run" and event.get("action") == "completed",
            "Publisher only accepts completed workflow_run events")
    branch = repository(api)
    default = sha(env.get("GITHUB_SHA"))
    require(env.get("GITHUB_WORKFLOW_SHA") == default and env.get("GITHUB_REF") == "refs/heads/" + branch and
            resolve_ref(api, "heads/" + branch) == default, "Publisher must execute the current trusted default commit")
    event_run = event.get("workflow_run", {})
    run_id, attempt = integer(event_run.get("id"), "upstream run ID"), integer(event_run.get("run_attempt"), "upstream attempt")
    run = validate_run(api, run_id, attempt, True)
    require(event_run.get("head_sha") == run["head_sha"] and event_run.get("workflow_id") == run["workflow_id"] and
            event_run.get("event") == run["event"] and event_run.get("conclusion") == "success",
            "Workflow event does not match the current successful run")
    blobs = trusted_blobs(api, default)
    require(trusted_blobs(api, run["head_sha"]) == blobs, "Upstream workflow/policy is not trusted")
    ancestor(api, run["head_sha"], default)
    artifact = artifact_for_run(api, run_id, attempt)
    require(artifact["workflow_run"].get("head_sha") == run["head_sha"], "Artifact head mismatch")
    return {"schema": 1, "repository": REPOSITORY, "repository_id": REPOSITORY_ID,
            "trusted_default_sha": default, "default_branch": branch, "trusted_blobs": blobs,
            "run_id": run_id, "run_attempt": attempt, "event": run["event"],
            "run_head_sha": run["head_sha"], "run_head_branch": run.get("head_branch"),
            "workflow_id": run["workflow_id"], "artifact": artifact}


def verify_zip_digest(data, artifact):
    require(len(data) == artifact["size_in_bytes"] and "sha256:" + sha256(data) == artifact["digest"],
            "Downloaded artifact size/digest mismatch")


def assert_no_release(api, tag):
    # List authenticated releases because a draft may not be returned by /tags/.
    for page in range(1, 101):
        releases = api.request("GET", api_path(f"/releases?per_page=100&page={page}"))
        require(isinstance(releases, list) and len(releases) <= 100, "Invalid release inventory")
        require(not any(item.get("tag_name") == tag for item in releases), "A release already exists for this tag")
        if len(releases) < 100:
            break
    else:
        raise GuardError("Release inventory exceeds pagination limit")
    try:
        api.request("GET", api_path("/releases/tags/" + urllib.parse.quote(tag, safe="")))
    except APIError as exc:
        if exc.status == 404:
            return
        raise
    raise GuardError("A release already exists for this tag")


def verify_provenance(files, policy, api):
    provenance = strict_json(files["PROVENANCE.json"])
    expected_keys = {"schema", "repository", "repository_id", "run_id", "run_attempt", "event", "tag", "version", "source_sha",
                     "run_head_sha", "workflow_sha", "workflow_path", "default_branch", "default_sha", "trusted_blobs", "artifact_name", "assets"}
    require(isinstance(provenance, dict) and set(provenance) == expected_keys, "Invalid provenance fields")
    for key in ("schema", "repository_id", "run_id", "run_attempt"):
        integer(provenance[key], "provenance " + key)
    require(isinstance(provenance["assets"], dict), "Invalid provenance assets")
    for metadata in provenance["assets"].values():
        require(isinstance(metadata, dict) and set(metadata) == {"sha256", "size"}, "Invalid asset metadata")
        integer(metadata["size"], "asset size")
        require(isinstance(metadata["sha256"], str) and HASH.fullmatch(metadata["sha256"]), "Invalid asset digest")
    for key in ("schema", "repository", "repository_id", "run_id", "run_attempt", "event", "run_head_sha", "default_branch", "trusted_blobs"):
        require(provenance[key] == policy[key], "Provenance/run policy mismatch: " + key)
    require(provenance["workflow_path"] == BUILD_WORKFLOW and provenance["workflow_sha"] == policy["run_head_sha"] and
            provenance["artifact_name"] == policy["artifact"]["name"], "Provenance workflow/artifact mismatch")
    tag = provenance["tag"]
    require(validate_tag(tag) == provenance["version"], "Provenance version/tag mismatch")
    source = sha(provenance["source_sha"])
    if policy["event"] == "push":
        require(source == policy["run_head_sha"] and tag == policy["run_head_branch"],
                "Tag-push source/tag does not match upstream head")
    else:
        require(policy["run_head_branch"] == policy["default_branch"], "Manual upstream run was not on the default branch")
    require(resolve_ref(api, "tags/" + tag) == source, "Release tag moved")
    ancestor(api, source, policy["trusted_default_sha"])
    ancestor(api, sha(provenance["default_sha"]), policy["trusted_default_sha"])
    require(trusted_blobs(api, source) == policy["trusted_blobs"] and
            trusted_blobs(api, provenance["default_sha"]) == policy["trusted_blobs"], "Source/build policy differs from trusted default")
    package = {key: value for key, value in files.items() if key != "PROVENANCE.json"}
    assets = validate_package(package, source, provenance["version"])
    require(provenance["assets"] == assets, "Provenance asset inventory mismatch")
    verify_source_archive(api, package, provenance)
    return provenance


def recheck(api, policy, provenance):
    require(repository(api) == policy["default_branch"] and
            resolve_ref(api, "heads/" + policy["default_branch"]) == policy["trusted_default_sha"], "Trusted default ref changed")
    require(resolve_ref(api, "tags/" + provenance["tag"]) == provenance["source_sha"], "Release tag moved")
    run = validate_run(api, policy["run_id"], policy["run_attempt"], True)
    require(run["head_sha"] == policy["run_head_sha"] and run["event"] == policy["event"] and
            run.get("head_branch") == policy["run_head_branch"], "Upstream run changed")


def publish(api, policy, archive_bytes):
    verify_zip_digest(archive_bytes, policy["artifact"])
    files = read_artifact_zip(archive_bytes)
    provenance = verify_provenance(files, policy, api)
    recheck(api, policy, provenance)
    current_artifact = artifact_for_run(api, policy["run_id"], policy["run_attempt"])
    require(all(current_artifact[key] == policy["artifact"][key] for key in ("id", "name", "size_in_bytes", "digest")),
            "Artifact identity changed after download")
    assert_no_release(api, provenance["tag"])
    recheck(api, policy, provenance)
    # No code from the artifact is extracted, imported, sourced or executed.
    # Never retry any mutation, even on timeout/502/422. A tag cannot be locked
    # atomically with GitHub Releases; repeated checks bound, but cannot erase,
    # this external TOCTOU window. Concurrent movers must be prohibited by policy.
    fields = {"tag_name": provenance["tag"], "target_commitish": provenance["source_sha"],
              "name": "星屿云 " + provenance["version"],
              "body": f"自动生成的审阅草稿。源码提交：`{provenance['source_sha']}`。\n\nLinux amd64；支付和邮件适配器保持禁用。发布前请完成安装、升级、备份恢复及安全门禁审阅。\n\n构建运行：{policy['run_id']}，尝试：{policy['run_attempt']}。附件包含校验和及构建来源记录。",
              "draft": True, "prerelease": True, "make_latest": "false", "generate_release_notes": False}
    release_id = None
    try:
        created = api.request("POST", api_path("/releases"), data=fields)
        release_id = integer(created.get("id"), "created release ID")
        require(created.get("draft") is True and created.get("prerelease") is True and
                created.get("tag_name") == provenance["tag"], "Unexpected created release state")
        for name in sorted(files):
            recheck(api, policy, provenance)
            current = api.request("GET", api_path(f"/releases/{release_id}"))
            require(current.get("id") == release_id and current.get("draft") is True and current.get("prerelease") is True and
                    current.get("tag_name") == provenance["tag"] and isinstance(current.get("assets"), list),
                    "Draft changed during upload")
            require(not any(asset.get("name") == name for asset in current["assets"]), "Asset already exists; overwrite forbidden")
            uploaded = api.upload(release_id, name, files[name])
            require(uploaded.get("name") == name and uploaded.get("size") == len(files[name]) and
                    uploaded.get("state") == "uploaded" and uploaded.get("digest") == "sha256:" + sha256(files[name]),
                    "Asset upload verification failed")
        recheck(api, policy, provenance)
        final = api.request("GET", api_path(f"/releases/{release_id}"))
        require(final.get("id") == release_id and isinstance(final.get("assets"), list), "Final draft identity mismatch")
        asset_ids = []
        for asset in final["assets"]:
            asset_ids.append(integer(asset.get("id"), "uploaded asset ID"))
            require(asset.get("state") == "uploaded", "Incomplete release asset")
        require(len(set(asset_ids)) == len(asset_ids), "Duplicate release asset IDs")
        expected = {name: (len(data), "sha256:" + sha256(data)) for name, data in files.items()}
        actual = {asset.get("name"): (asset.get("size"), asset.get("digest")) for asset in final.get("assets", [])}
        require(final.get("draft") is True and final.get("prerelease") is True and
                final.get("tag_name") == provenance["tag"] and actual == expected and len(final["assets"]) == len(expected),
                "Final draft asset inventory/state mismatch")
        return release_id
    except (GuardError, KeyError, TypeError, ValueError) as exc:
        if release_id is not None:
            raise GuardError(f"Publication stopped; inspect draft release ID {release_id}. No edit/delete/retry performed. {exc}") from None
        raise GuardError("Release creation failed or has an uncertain outcome; inspect repository releases for tag " + provenance["tag"] + " before any new attempt. No mutation retry performed. " + str(exc)) from None


def outputs(values):
    destination = os.environ.get("GITHUB_OUTPUT")
    if destination:
        with open(destination, "a", encoding="utf-8") as stream:
            for key, value in values.items():
                text = str(value)
                require(re.fullmatch(r"[a-z_]+", key) and "\n" not in text and "\r" not in text, "Unsafe workflow output")
                stream.write(f"{key}={text}\n")


def write_new(path, data):
    with Path(path).open("xb") as stream:
        stream.write(data)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("prepare-build", "seal-build", "prepare-publish", "publish"):
        cmd = sub.add_parser(command)
        cmd.add_argument("--policy", required=True)
        if command == "seal-build":
            cmd.add_argument("--directory", required=True)
        if command == "prepare-publish":
            cmd.add_argument("--download", required=True)
        if command == "publish":
            cmd.add_argument("--artifact", required=True)
    args = parser.parse_args(argv)
    if args.command == "seal-build":
        seal_build(strict_json(Path(args.policy).read_bytes()), args.directory)
        print("Release package sealed; no publication performed.")
        return
    api = GitHub(os.environ.get("GH_TOKEN"))
    if args.command in {"prepare-build", "prepare-publish"}:
        event = strict_json(Path(os.environ["GITHUB_EVENT_PATH"]).read_bytes())
        if args.command == "prepare-build":
            policy = prepare_build(api, os.environ, event)
            outputs({key: policy[key] for key in ("source_sha", "tag", "version", "artifact_name")})
        else:
            policy = prepare_publish(api, os.environ, event)
            data = api.download_artifact(policy["artifact"])
            # Reject all malformed/untrusted payloads before any mutation.
            # Token permissions remain job-wide, including this read-only stage.
            verify_provenance(read_artifact_zip(data), policy, api)
            write_new(args.download, data)
            outputs({"artifact_id": policy["artifact"]["id"], "artifact_name": policy["artifact"]["name"],
                     "run_id": policy["run_id"], "run_attempt": policy["run_attempt"]})
        write_new(args.policy, json_bytes(policy))
        print("Release policy validated; no publication performed.")
    else:
        policy = strict_json(Path(args.policy).read_bytes())
        artifact = Path(args.artifact)
        require(artifact.is_file() and not artifact.is_symlink() and artifact.stat().st_size <= MAX_ZIP, "Unsafe artifact file")
        release_id = publish(api, policy, artifact.read_bytes())
        outputs({"release_id": release_id})
        print(f"Created draft prerelease ID {release_id}; no publication/deployment performed.")


if __name__ == "__main__":
    try:
        main()
    except (GuardError, KeyError, TypeError, ValueError, OSError) as exc:
        print("Release guard stopped: " + str(exc), file=sys.stderr)
        sys.exit(1)
