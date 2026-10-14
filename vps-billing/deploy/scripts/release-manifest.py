#!/usr/bin/env python3
"""Deterministic release inventories; never include local dependency cache paths."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n")


def prune(root):
    """Exclude build output, local configuration and recorded test output."""
    for base, dirs, files in os.walk(root, topdown=True):
        for name in list(dirs):
            if name in {".git", "node_modules", "dist", "bin", "artifacts", "secrets", "backups", "test-results", "playwright-report", "__pycache__"}:
                shutil.rmtree(Path(base) / name)
                dirs.remove(name)
        for name in files:
            if ((name.startswith(".env") and name != ".env.example") or
                name.endswith((".log", ".tsbuildinfo", ".sql.gz", "-results.txt", ".pyc"))):
                (Path(base) / name).unlink()


def tool(*args):
    return subprocess.check_output(args, text=True).strip()


def notices(source, target):
    target.mkdir(parents=True, exist_ok=True)
    copied = []
    for path in sorted(source.iterdir()):
        if path.is_file() and re.match(r"^(licen[sc]e|copying|notice|copyright)([._-]|$)", path.name, re.I):
            shutil.copyfile(path, target / path.name)
            copied.append(path.name)
    return copied


def go_dependency_notices(entry, target, linked_modules):
    linked = entry["Path"] in linked_modules
    if not linked:
        # Treat graph-only nodes identically whether a shared cache happens to
        # contain their source or not. They are not included in this binary.
        return {"linked_in_binary": False, "source_status": "module_graph_only", "notice_files": []}
    directory = entry.get("Dir")
    if not directory:
        raise SystemExit("Linked Go dependency source unavailable: " + entry["Path"])
    return {"linked_in_binary": True, "source_status": "source_available", "notice_files": notices(Path(directory), target)}


def go_dependency_metadata(entry, linked_modules):
    # GoVersion and Sum for lazy unlinked nodes can depend on what was downloaded
    # by unrelated builds. Record only the graph's authoritative path/version.
    keys = ("Path", "Version") if not entry.get("Main") and entry["Path"] not in linked_modules else ("Path", "Version", "Sum", "GoVersion", "Main")
    return {key: entry[key] for key in keys if key in entry}


def manifest(source, bundle, modules_path, build_path, commit, version, epoch):
    project = source / "vps-billing"
    build_lines = build_path.read_text().splitlines()
    linked_modules = {fields[1] for line in build_lines if len(fields := line.split()) >= 2 and fields[0] == "dep"}
    modules = []
    decoder = json.JSONDecoder()
    raw = modules_path.read_text()
    while raw.strip():
        entry, end = decoder.raw_decode(raw.lstrip())
        raw = raw.lstrip()[end:]
        if entry.get("Replace"):
            raise SystemExit("Release disallows local/replacement Go modules; review and update recipe first")
        item = go_dependency_metadata(entry, linked_modules)
        if not entry.get("Main"):
            dest = bundle / "licenses/go" / (entry["Path"].replace("/", "__") + "@" + entry["Version"])
            item.update(go_dependency_notices(entry, dest, linked_modules))
        modules.append(item)
    npm = []
    for path in sorted((project / "frontend/node_modules").rglob("package.json")):
        # Only actual package roots, excluding test fixture/package-example JSON.
        if path.parent.parent.name != "node_modules" and not (path.parent.parent.name.startswith("@") and path.parent.parent.parent.name == "node_modules"):
            continue
        value = json.loads(path.read_text())
        if not value.get("name") or not value.get("version"):
            continue
        item = {key: value[key] for key in ("name", "version", "license", "licenses") if key in value}
        package_id = re.sub(r"[^a-zA-Z0-9@._-]", "_", value["name"] + "@" + value["version"])
        item["notice_files"] = notices(path.parent, bundle / "licenses/npm" / package_id)
        npm.append(item)
    goroot = Path(tool("go", "env", "GOROOT"))
    notices(goroot, bundle / "licenses/go-runtime")
    write_json(bundle / "manifests/go-dependencies.json", sorted(modules, key=lambda v: v["Path"]))
    write_json(bundle / "manifests/npm-installed-dependencies.json", sorted(npm, key=lambda v: (v["name"], v["version"])))
    # First line from `go version -m` contains a random staging path. Remove it.
    (bundle / "manifests/go-build.txt").write_text("aster-api: " + build_lines[0].split(":", 1)[-1].strip() + "\n" + "\n".join(build_lines[1:]) + "\n")
    inputs = {}
    for relative in ("LICENSE", "README.md", "vps-billing/backend/go.mod", "vps-billing/backend/go.sum", "vps-billing/frontend/package.json", "vps-billing/frontend/package-lock.json"):
        inputs[relative] = hashlib.sha256((source / relative).read_bytes()).hexdigest()
    info = {
        "release_label": version, "source_commit": commit, "source_date_epoch": int(epoch),
        "target": "linux/amd64", "cgo_enabled": False,
        "tools": {"go": tool("go", "version"), "node": tool("node", "--version"), "npm": tool("npm", "--version"), "tar": tool("tar", "--version").splitlines()[0], "gzip": tool("gzip", "--version").splitlines()[0], "python": tool("python3", "--version")},
        "go_build_flags": ["-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-s -w"],
        "frontend_build": ["npm ci --no-audit --no-fund", "npm run build"],
        "input_sha256": inputs,
        "source_archive": "Git commit paths LICENSE, README.md, vps-billing; local secrets, build/dependency directories and recorded test outputs excluded",
        "dependency_inventory": "Go module graph (unlinked nodes explicitly marked) and npm installed package metadata plus original lockfiles; not a complete SPDX/CycloneDX SBOM or license compliance certification",
        "release_status": "review candidate; disabled payment/email; no deployment or publication performed",
    }
    write_json(bundle / "manifests/BUILD.json", info)
    (bundle / "licenses/README.txt").write_text(
        "Dependency notices copied from top-level LICENSE/COPYING/NOTICE/COPYRIGHT files of linked Go modules, Go runtime and installed npm packages.\n"
        "Unlinked Go graph entries are marked module_graph_only with path/version only and no copied notices, independently of cache contents; linked dependencies must have source available.\n"
        "Original package license metadata and lockfiles are in manifests/. Build-only npm packages may be included.\n"
        "Nested, generated, nonstandard or missing license notices require manual review. This inventory is not a complete SBOM or a legal determination.\n"
        "The repository LICENSE is preserved unchanged at the archive root.\n"
    )


if __name__ == "__main__":
    if sys.argv[1] == "prune":
        prune(Path(sys.argv[2]))
    elif sys.argv[1] == "manifest":
        manifest(*(Path(x) for x in sys.argv[2:6]), *sys.argv[6:])
    else:
        raise SystemExit("Unknown action")
