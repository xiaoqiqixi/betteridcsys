#!/usr/bin/env python3
"""Run sandboxed browser acceptance against owned loopback demo processes only.

Requires check.sh's existing npm dependencies and built frontend/dist. No browser
installation, database, SMTP, privileged host changes, or sandbox fallback occurs.
Only summary.json and validated synthetic screenshots are retained; process logs,
the demo binary, browser profile and temporary preview configuration are removed.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


class Failure(Exception):
    """A bounded, nonsecret diagnostic suitable for the public CI summary."""


class Interrupted(Failure):
    pass


def clean_environment(source, scratch):
    # An allowlist also excludes less obvious inherited credentials, Node
    # injection, proxy settings, Playwright overrides and provider/test settings.
    original_home = Path(source.get("HOME", str(Path.home())))
    env = {key: source[key] for key in ("PATH", "HOME", "LANG", "LC_ALL", "TZ") if key in source}
    env.update({
        "TMPDIR": str(scratch / "tmp"),
        "XDG_CACHE_HOME": str(scratch / "cache"),
        "XDG_CONFIG_HOME": str(scratch / "config"),
        "GOPATH": source.get("GOPATH", str(original_home / "go")),
        "GOCACHE": source.get("GOCACHE", str(original_home / ".cache/go-build")),
        "GOENV": "off", "GOWORK": "off", "GOTOOLCHAIN": "local",
        "GOPROXY": "off", "GOSUMDB": "off", "CGO_ENABLED": "0",
        "GOOS": "linux", "GOARCH": "amd64",
        "NO_PROXY": "127.0.0.1,localhost,::1", "no_proxy": "127.0.0.1,localhost,::1",
        "CI": "true", "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
    })
    for directory in ("tmp", "cache", "config"):
        (scratch / directory).mkdir(mode=0o700)
    return env


def validate_inputs(repo, chromium, output):
    if sys.platform != "linux" or os.uname().machine != "x86_64":
        raise Failure("Linux amd64 is required")
    if not repo.is_absolute() or not chromium.is_absolute() or not output.is_absolute():
        raise Failure("Repository, Chrome and output paths must be absolute")
    repo = repo.resolve(strict=True)
    for name in ("backend/go.mod", "frontend/dist/index.html", "frontend/tests/e2e.mjs",
                 "frontend/node_modules/vite/bin/vite.js"):
        path = repo / "vps-billing" / name
        if not path.is_file() or not path.resolve().is_relative_to(repo):
            raise Failure("Required source, built frontend or installed Vite is missing")
    source = (repo / "vps-billing/frontend/tests/e2e.mjs").read_text(encoding="utf-8")
    if not re.search(r"chromiumSandbox\s*:\s*true\b", source) or "--no-sandbox" in source:
        raise Failure("Browser test must explicitly require the Chromium sandbox")
    chromium = chromium.resolve(strict=True)
    mode = chromium.stat()
    if (not stat.S_ISREG(mode.st_mode) or not os.access(chromium, os.X_OK)
            or mode.st_uid not in (0, os.geteuid()) or mode.st_mode & 0o022):
        raise Failure("Chrome must be an existing trusted executable without shared write access "
                      f"(uid={mode.st_uid}, expected=0/{os.geteuid()}, "
                      f"mode={stat.S_IMODE(mode.st_mode):04o}, executable={os.access(chromium, os.X_OK)})")
    if output.exists() or output.is_symlink():
        raise Failure("Evidence output must be a new directory")
    parent = output.parent.resolve(strict=True)
    output = parent / output.name
    if output == repo or output.is_relative_to(repo):
        raise Failure("Evidence output must be outside the source checkout")
    shots = set(re.findall(r'await\s+shot\("([a-z0-9-]+)"\)', source))
    if not shots or len(shots) > 30:
        raise Failure("Browser test must declare a bounded set of named screenshots")
    return repo, chromium, output, {name + ".png" for name in shots}


def reserve_ports():
    sockets = []
    try:
        for _ in range(2):
            listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sockets.append(listener)
            listener.bind(("127.0.0.1", 0))
        ports = [listener.getsockname()[1] for listener in sockets]
        if ports[0] == ports[1]:
            raise Failure("Demo ports must be distinct")
        return sockets, ports
    except BaseException:
        for listener in sockets:
            listener.close()
        raise


def listener_owned(process, port):
    """Require the live process itself to own the exact loopback listener inode."""
    if process.poll() is not None:
        return False
    expected = "0100007F:%04X" % port
    try:
        inodes = {line.split()[9] for line in Path("/proc/net/tcp").read_text().splitlines()[1:]
                  if line.split()[1] == expected and line.split()[3] == "0A"}
        links = {os.readlink(path) for path in Path(f"/proc/{process.pid}/fd").iterdir()}
        return any(f"socket:[{inode}]" in links for inode in inodes) and process.poll() is None
    except (OSError, IndexError):
        return False


def process_snapshot():
    result = {}
    for path in Path("/proc").iterdir():
        if not path.name.isdigit():
            continue
        try:
            fields = (path / "stat").read_text().rsplit(") ", 1)[1].split()
            result[int(path.name)] = (int(fields[1]), fields[19], fields[0])
        except (OSError, ValueError, IndexError):
            pass
    return result


class Processes:
    def __init__(self):
        self.children = []
        self.logs = []
        self.owned = {}  # pid -> (birth ticks, kernel pidfd)
        if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
            raise Failure("Linux process identity handles are required for safe cleanup")
        if any(row[0] == os.getpid() for row in process_snapshot().values()):
            raise Failure("Browser supervisor must begin without unrelated child processes")
        # Playwright deliberately detaches Chrome into another session. A
        # process-local subreaper retains ownership of orphaned descendants;
        # this does not alter host security or the browser sandbox.
        self.libc = ctypes.CDLL(None, use_errno=True)
        previous = ctypes.c_int()
        if self.libc.prctl(37, ctypes.byref(previous), 0, 0, 0) != 0:
            raise Failure("Cannot inspect process-local child supervision")
        self.previous_subreaper = previous.value
        if self.libc.prctl(36, 1, 0, 0, 0) != 0:
            raise Failure("Cannot enable process-local child supervision")

    def sample(self):
        snapshot = process_snapshot()
        # Capture direct children only. The subreaper adopts grandchildren as
        # their parents exit, including detached Chrome. Avoid inferring a
        # multi-hop ancestry from a non-atomic /proc snapshot with reusable PIDs.
        for pid, (parent, birth, _state) in snapshot.items():
            if parent != os.getpid() or (pid in self.owned and self.owned[pid][0] == birth):
                continue
            try:
                descriptor = os.pidfd_open(pid)
            except ProcessLookupError:
                continue
            current = process_snapshot().get(pid)
            if current is None or current[0] != os.getpid() or current[1] != birth:
                os.close(descriptor)
                continue
            if pid in self.owned:
                os.close(self.owned[pid][1])
            self.owned[pid] = (birth, descriptor)

    def signal_owned(self, number):
        # pidfds remain tied to the original process after its numerical PID
        # is reused. Never signal a stored PID/PGID obtained from a dead leader.
        clean = True
        self.sample()
        for _birth, descriptor in self.owned.values():
            try:
                signal.pidfd_send_signal(descriptor, number)
            except ProcessLookupError:
                pass
            except OSError:
                clean = False
        return clean

    def live(self):
        self.sample()
        for _birth, descriptor in self.owned.values():
            poller = select.poll()
            poller.register(descriptor, select.POLLIN)
            if not poller.poll(0):
                return True
        return False

    def start(self, arguments, cwd, env, log):
        stream = log.open("xb")
        self.logs.append(stream)
        process = subprocess.Popen(arguments, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                   stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        self.children.append(process)
        self.sample()
        return process

    def wait(self, process, timeout, required=()):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.sample()
            if any(child.poll() is not None for child in required):
                raise Failure("An owned demo service exited during browser acceptance")
            result = process.poll()
            if result is not None:
                return result
            time.sleep(0.05)
        raise Failure("The current stage exceeded its bounded deadline")

    def cleanup(self, timeout=8):
        clean = self.signal_owned(signal.SIGTERM)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and self.live():
            clean = self.signal_owned(signal.SIGTERM) and clean
            time.sleep(0.05)
        clean = self.signal_owned(signal.SIGKILL) and clean
        kill_deadline = time.monotonic() + 2
        while time.monotonic() < kill_deadline and self.live():
            clean = self.signal_owned(signal.SIGKILL) and clean
            time.sleep(0.05)
        clean = not self.live() and clean
        for process in self.children:
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                clean = False
        for pid, (_birth, descriptor) in self.owned.items():
            try:
                os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                pass
            os.close(descriptor)
        for stream in self.logs:
            stream.close()
        if self.libc.prctl(36, self.previous_subreaper, 0, 0, 0) != 0:
            clean = False
        return clean


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise Failure("Demo readiness must not redirect")


def readiness(process, port, session=False, timeout=30):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    deadline = time.monotonic() + timeout
    route = "/api/v1/session" if session else "/readyz"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise Failure("The owned demo process exited before readiness")
        if listener_owned(process, port):
            try:
                with opener.open(f"http://127.0.0.1:{port}{route}", timeout=1) as response:
                    data = response.read(65537)
                    if response.status != 200 or len(data) > 65536:
                        raise Failure("Unexpected demo readiness response")
                    payload = json.loads(data)
                    if session and payload.get("data", {}).get("demo_mode") is not True:
                        raise Failure("The browser target is not an in-memory demo")
                    if not session and payload.get("data", {}).get("status") != "ready":
                        raise Failure("Unexpected API readiness status")
                    if listener_owned(process, port):
                        return
            except (OSError, ValueError, urllib.error.URLError):
                pass
        time.sleep(0.1)
    raise Failure("The owned loopback demo did not become ready before its deadline")


def preview_config(frontend, api_port, ui_port):
    # Vite preview normally inherits server.proxy. Keep the same /api Host and
    # Origin semantics explicitly, while avoiding repository .env/plugin loading.
    target = f"http://127.0.0.1:{api_port}"
    return {"root": str(frontend), "envDir": False, "build": {"outDir": "dist"},
            "preview": {"host": "127.0.0.1", "port": ui_port, "strictPort": True,
                        "proxy": {route: {"target": target, "changeOrigin": False}
                                  for route in ("/api", "/healthz", "/readyz")}}}


def browser_diagnostic(log):
    # Browser input is synthetic and caller credentials were removed. Still
    # discard stack paths, control characters and all but a short tail.
    try:
        with log.open("rb") as stream:
            stream.seek(max(0, log.stat().st_size - 8192))
            tail = stream.read(8192).decode("utf-8", errors="replace")
    except OSError:
        return "Browser acceptance failed; no diagnostic was available"
    lower = tail.lower()
    if any(text in lower for text in ("no usable sandbox", "sandboxing is not supported", "failed to move to new namespace", "without --no-sandbox", "sandbox setup failed", "operation not permitted")):
        return "Chrome sandbox initialization failed; no sandbox bypass was attempted"
    lines = [line.strip() for line in tail.splitlines()
             if line.strip() and not line.lstrip().startswith(("at ", "<launching>", "<launched>"))]
    message = " | ".join(lines[-10:])
    message = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", message)
    message = re.sub(r"(?:file://)?/(?:[^\s|]+/)+[^\s|]*", "[private path]", message)
    return "".join(c for c in message if c >= " " and c != "\x7f")[:1600] or "Browser acceptance failed"


def retain_screenshots(source, destination, expected):
    paths = list(source.iterdir()) if source.is_dir() and not source.is_symlink() else []
    if {p.name for p in paths} != expected:
        raise Failure("Screenshot evidence is incomplete or contains unexpected files")
    assets, total = [], 0
    for path in sorted(paths):
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as stream:
            mode = os.fstat(stream.fileno())
            if (not stat.S_ISREG(mode.st_mode) or mode.st_nlink != 1
                    or not re.fullmatch(r"[a-z0-9-]{1,80}\.png", path.name)
                    or not 8 <= mode.st_size <= 8 * 1024 * 1024):
                raise Failure("Unsafe screenshot evidence")
            raw = stream.read(8 * 1024 * 1024 + 1)
            after = os.fstat(stream.fileno())
            if len(raw) != mode.st_size or after.st_size != mode.st_size or after.st_mtime_ns != mode.st_mtime_ns:
                raise Failure("Screenshot changed while evidence was being read")
        total += len(raw)
        if raw[:8] != b"\x89PNG\r\n\x1a\n" or total > 64 * 1024 * 1024:
            raise Failure("Invalid or oversized screenshot evidence")
        assets.append((path.name, raw))
    destination.mkdir(mode=0o700)
    results = []
    for name, raw in assets:
        (destination / name).write_bytes(raw)
        results.append({"name": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()})
    return results


def run(repo, chromium, output):
    os.umask(0o077)
    repo, chromium, output, expected = validate_inputs(repo, chromium, output)
    output.mkdir(mode=0o700)
    processes = None
    scratch = None
    listeners = []
    summary = {"passed": False, "stage": "setup", "cleanup": False,
               "sandbox_required": True, "demo_mode": True, "real_email": False,
               "screenshots": []}
    prior = {}
    def interrupted(signum, _frame):
        raise Interrupted("Interrupted by " + signal.Signals(signum).name)
    for number in (signal.SIGINT, signal.SIGTERM):
        prior[number] = signal.signal(number, interrupted)
    try:
        processes = Processes()
        scratch = Path(tempfile.mkdtemp(prefix="aster-browser-demo-"))
        env = clean_environment(os.environ, scratch)
        go, node = shutil.which("go", path=env.get("PATH")), shutil.which("node", path=env.get("PATH"))
        if not go or not node:
            raise Failure("Existing Go and Node executables are required")
        git = shutil.which("git", path=env.get("PATH"))
        if not git:
            raise Failure("Existing Git executable is required")
        revision_log = scratch / "source-revision.log"
        revision = processes.start([git, "rev-parse", "--verify", "HEAD"], repo, env, revision_log)
        if processes.wait(revision, 10) != 0:
            raise Failure("Cannot identify the checked-out source commit")
        source_commit = revision_log.read_text(encoding="ascii").strip()
        if not re.fullmatch("[a-f0-9]{40}", source_commit):
            raise Failure("Unexpected source commit identity")
        summary["source_commit"] = source_commit
        frontend = repo / "vps-billing/frontend"
        listeners, (api_port, ui_port) = reserve_ports()
        summary["stage"] = "source-before"
        binary = scratch / "aster-api"
        before_log=scratch / "source-before.log"
        clean_before = processes.start([git,"status","--porcelain","--untracked-files=normal"],repo,env,before_log)
        if processes.wait(clean_before,10)!=0 or before_log.stat().st_size!=0:
            raise Failure("Source must have no tracked changes or nonignored untracked files before browser acceptance")
        summary["stage"] = "browser-version"
        version_log = scratch / "browser-version.log"
        version = processes.start([str(chromium), "--version"], scratch, env, version_log)
        if processes.wait(version, 10) != 0 or version_log.stat().st_size > 256:
            raise Failure("The validated Chrome executable could not report its version")
        chrome_version = version_log.read_text(encoding="ascii").strip()
        if not re.fullmatch(r"(?:Google Chrome|Chromium) [0-9]{1,4}(?:\.[0-9]{1,4}){3}", chrome_version):
            raise Failure("The validated Chrome executable reported an unexpected version")
        summary["browser_version"] = chrome_version
        summary["stage"] = "build-api"
        build = processes.start([go, "build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-o", str(binary), "./cmd/server"],
                                repo / "vps-billing/backend", env, scratch / "build.log")
        if processes.wait(build, 180) != 0:
            raise Failure("API build failed; dependencies must already be cached by required checks")
        summary["stage"] = "start-api"
        api_env = dict(env, APP_MODE="demo", APP_ORIGIN=f"http://127.0.0.1:{ui_port}",
                       LISTEN_ADDR=f"127.0.0.1:{api_port}",
                       PAYMENT_PROVIDER="payment.disabled", EMAIL_PROVIDER="email.disabled")
        listeners[0].close()
        api = processes.start([str(binary)], scratch, api_env, scratch / "api.log")
        readiness(api, api_port)
        summary["stage"] = "start-preview"
        config = scratch / "preview.mjs"
        config.write_text("export default " + json.dumps(preview_config(frontend, api_port, ui_port)) + ";\n", encoding="utf-8")
        listeners[1].close()
        preview = processes.start([node, str(frontend / "node_modules/vite/bin/vite.js"), "preview",
                                   "--config", str(config), "--host", "127.0.0.1", "--port", str(ui_port), "--strictPort"],
                                  frontend, env, scratch / "preview.log")
        readiness(preview, ui_port, session=True)
        if not listener_owned(api, api_port):
            raise Failure("The owned API listener disappeared before browser acceptance")
        summary["stage"] = "browser"
        screenshots = scratch / "screenshots"
        browser_env = dict(env, TEST_BASE_URL=f"http://127.0.0.1:{ui_port}",
                           E2E_OUTPUT_DIR=str(screenshots), CHROMIUM_PATH=str(chromium))
        browser_log = scratch / "browser.log"
        browser = processes.start([node, str(frontend / "tests/e2e.mjs")], frontend, browser_env, browser_log)
        result = processes.wait(browser, 240, required=(api, preview))
        if result != 0:
            raise Failure(browser_diagnostic(browser_log))
        if not listener_owned(api, api_port) or not listener_owned(preview, ui_port):
            raise Failure("An owned loopback listener disappeared during browser acceptance")
        summary["stage"] = "source-after"
        after_log=scratch / "source-after.log"
        clean_after = processes.start([git,"status","--porcelain","--untracked-files=normal"],repo,env,after_log)
        if processes.wait(clean_after,10,required=(api,preview))!=0 or after_log.stat().st_size!=0:
            raise Failure("Tracked or nonignored source inputs changed during browser acceptance")
        summary["stage"] = "evidence"
        summary["screenshots"] = retain_screenshots(screenshots, output / "screenshots", expected)
        summary["passed"] = True
        summary["stage"] = "complete"
    except Failure as error:
        summary["reason"] = str(error)
    except (OSError, ValueError, subprocess.SubprocessError):
        summary["reason"] = "The current stage failed; private process logs were not retained"
    finally:
        for number in prior:
            signal.signal(number, signal.SIG_IGN)
        for listener in listeners:
            listener.close()
        try:
            clean = processes.cleanup() if processes is not None else True
        except (Failure, OSError):
            clean = False
        if scratch is not None:
            try:
                shutil.rmtree(scratch)
            except OSError:
                clean = False
        summary["cleanup"] = clean
        if not clean:
            summary["passed"] = False
            summary["reason"] = "Owned process or temporary-directory cleanup failed"
        (output / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        for number, handler in prior.items():
            signal.signal(number, handler)
    print(json.dumps(summary, sort_keys=True))
    return 0 if summary["passed"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--chromium-path", type=Path, required=True)
    args = parser.parse_args()
    try:
        return run(args.repo_root, args.chromium_path, args.output)
    except Failure as error:
        print("FAIL: browser demo input validation: " + str(error), file=sys.stderr)
        return 1
    except (OSError, ValueError):
        print("FAIL: browser demo input validation failed; no browser or service was started", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
