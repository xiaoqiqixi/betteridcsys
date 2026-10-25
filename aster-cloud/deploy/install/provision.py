#!/usr/bin/env python3
"""Explicit opt-in native dependency and dedicated-MySQL provisioning.

This module is NOT invoked by plan/dry-run. All subprocess output is captured;
no scripts, third-party repositories, arbitrary package names or SQL are inputs.
Native integration of these paths remains an acceptance-test requirement.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import secrets
import stat
import subprocess
import time

APT_GET = "/usr/bin/apt-get"
MYSQL = "/usr/bin/mysql"
SYSTEMCTL = "/usr/bin/systemctl"
POLICY_PATH = Path("/usr/sbin/policy-rc.d")
APT_KEYRING = Path("/usr/share/keyrings/ubuntu-archive-keyring.gpg")
APT_WORK_ROOT = Path("/var/cache/aster-cloud-installer")
MYSQL_CONFIG = Path("/etc/mysql")
MYSQL_DATA = Path("/var/lib/mysql")
MYSQL_SOCKET = "/run/mysqld/mysqld.sock"
MYSQL_DROPIN = Path("/etc/systemd/system/mysql.service.d/aster-cloud-local-only.conf")
CODENAMES = {"22.04": "jammy", "24.04": "noble", "26.04": "resolute"}
PACKAGES = {"controller": ("ca-certificates", "openssl"),
            "node": ("ca-certificates", "qemu-utils", "qemu-system-x86", "libvirt-clients", "cloud-image-utils")}
SYSTEM_SCHEMAS = {"mysql", "sys", "information_schema", "performance_schema"}
RUNTIME_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE")
# 002_console_identity creates an FK; MySQL also requires REFERENCES on its
# parent table. This remains a dedicated-DB grant, never runtime/global access.
MIGRATION_PRIVILEGES = RUNTIME_PRIVILEGES + ("CREATE", "ALTER", "INDEX", "REFERENCES")
SAFE_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8", "HOME": "/root"}
MAX_OUTPUT = 1024 * 1024
MYSQL_LOCAL_DROPIN = b"[Service]\nExecStart=\nExecStart=/usr/sbin/mysqld --skip-networking --mysqlx=0\n"


class ProvisionError(Exception):
    pass


def fail(message):
    raise ProvisionError(message)


def _json(raw):
    def pairs(items):
        output = {}
        for key, value in items:
            if key in output:
                fail("Duplicate provisioning JSON field")
            output[key] = value
        return output
    try:
        value = json.loads(raw, object_pairs_hook=pairs)
        if not isinstance(value, dict):
            fail("Provisioning receipt must be an object")
        return value
    except (ValueError, UnicodeError):
        fail("Malformed provisioning receipt; manual review required")


def protected_path(path, *, directory=False, private=False, missing=False):
    p = Path(path)
    if not p.is_absolute() or str(p) != str(path) or any(c in str(p) for c in "\r\n\x00") or ".." in p.parts:
        fail("Canonical protected provisioning path required")
    for current in [*reversed(p.parents), p]:
        try:
            info = current.lstat()
        except FileNotFoundError:
            if missing:
                continue
            fail("Protected provisioning input missing")
        final = current == p
        if info.st_uid != 0 or info.st_mode & 0o022 or stat.S_ISLNK(info.st_mode):
            fail("Unsafe provisioning path ownership, mode or symlink")
        if not final and not stat.S_ISDIR(info.st_mode):
            fail("Provisioning ancestor must be a directory")
        if final and (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1) is False:
            fail("Unexpected provisioning file type or hardlink")
        if final and private and info.st_mode & 0o077:
            fail("Private root-only provisioning material required")
    return p


def read_private(path):
    p = protected_path(path, private=True)
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if info.st_uid != 0 or info.st_nlink != 1 or not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > MAX_OUTPUT:
            fail("Opened private provisioning inode rejected")
        raw = stream.read(MAX_OUTPUT + 1)
        if not raw or len(raw) > MAX_OUTPUT:
            fail("Private provisioning input empty or oversized")
        return raw


def ensure_dir(path, mode=0o700):
    p = protected_path(str(path), directory=True, missing=True)
    if not p.exists():
        if not p.parent.exists():
            ensure_dir(p.parent, 0o755)
        p.mkdir(mode=mode)
        p.chmod(mode)
    return p


def write_new(path, raw, mode=0o600):
    p = protected_path(str(path), private=mode == 0o600, missing=True)
    if p.exists():
        # Public APT configuration is nonsensitive but still root protected.
        fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o022 or stat.S_IMODE(info.st_mode) != mode:
                fail("Existing provisioning file has unsafe ownership or mode")
            if stream.read(len(raw) + 1) != raw:
                fail("Existing provisioning material differs; never overwritten")
        return
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, "wb") as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def save_receipt(path, receipt):
    protected_path(str(path), private=True, missing=True)
    temporary = path.with_suffix(".pending")
    if temporary.exists():
        fail("Interrupted provisioning receipt write; manual review required")
    write_new(temporary, (json.dumps(receipt, sort_keys=True, indent=2) + "\n").encode())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def run_fixed(argv, *, stdin=None, env=None, timeout=120):
    try:
        result = subprocess.run(argv, input=stdin, env=env or SAFE_ENV, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        fail("Fixed native provisioning command unavailable or timed out; output withheld")
    if result.returncode or len(result.stdout) > MAX_OUTPUT:
        fail("Fixed native provisioning command rejected; output withheld to protect secrets")
    return result.stdout


def root_target():
    if os.geteuid() != 0 or platform.system() != "Linux" or platform.machine() not in ("amd64", "x86_64"):
        fail("Native provisioning requires root on Ubuntu amd64")
    fields = {}
    try:
        for line in Path("/etc/os-release").read_text().splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                fields[key] = value.strip('"')
    except OSError:
        fail("Ubuntu release cannot be verified")
    if fields.get("ID") != "ubuntu" or fields.get("VERSION_ID") not in CODENAMES:
        fail("Native provisioning targets Ubuntu 22.04, 24.04 or 26.04 only")
    return CODENAMES[fields["VERSION_ID"]]


def dependency_plan(component, with_mysql=False):
    if component not in PACKAGES or with_mysql and component != "controller":
        fail("Invalid fixed dependency role")
    packages = list(PACKAGES[component]) + (["mysql-server", "mysql-client"] if with_mysql else [])
    return {"packages": packages, "source": "Ubuntu signed archive/security HTTPS only", "node_daemon_included": False,
            "service_autostart": "blocked during explicit fresh-host package transaction",
            "mysql_transport": "unix-socket-only" if with_mysql else "unchanged",
            "limitations": ["No APT upgrade/removal, third-party repository, firewall or host bridge edits",
                            "Node libvirt daemon/default-network installation remains separate native acceptance"]}


def _fresh_mysql_host():
    for p in (MYSQL_CONFIG, MYSQL_DATA, MYSQL_DROPIN.parent,
              Path("/etc/systemd/system/mysql.service"), Path("/etc/systemd/system/mysqld.service"),
              Path("/usr/sbin/mysqld"), Path(MYSQL_SOCKET)):
        if p.exists() or p.is_symlink():
            fail("MySQL package provisioning is fresh-host only; existing service/config/data is never modified")


def fresh_dependency_host(component):
    """Conservative evidence gate, not a claim to detect every possible workload."""
    paths = (Path("/var/lib/mysql"), Path("/var/lib/mariadb"), Path("/var/lib/postgresql"),
             Path("/var/lib/libvirt"), Path("/etc/libvirt"), Path("/opt/vps-billing"), Path("/opt/aster-billing"))
    if any(p.exists() or p.is_symlink() for p in paths):
        fail("Dependency installation is fresh dedicated-host only; existing database/virt/finance workloads refused")
    if component == "node":
        try:
            raw = Path("/proc/meminfo").read_text()
            memory = re.search(r"^MemTotal:\s+(\d+)\s+kB$", raw, re.M)
            if not memory or int(memory[1]) < 2 * 1024 * 1024 or not stat.S_ISCHR(Path("/dev/kvm").stat().st_mode):
                fail("Node dependency install requires a dedicated real KVM host with at least 2GiB; never the finance test server")
        except OSError:
            fail("Real KVM host evidence is absent; no node packages installed")


def _policy_bytes(nonce):
    return ("#!/bin/sh\n# aster-cloud-installer owned transient policy " + nonce + "\nexit 101\n").encode()


def _remove_owned_policy(receipt):
    if not POLICY_PATH.exists() and not POLICY_PATH.is_symlink():
        return
    protected_path(str(POLICY_PATH))
    expected = _policy_bytes(receipt["policy_nonce"])
    fd = os.open(POLICY_PATH, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        raw = stream.read(len(expected) + 1)
    if (raw != expected or info.st_ino != receipt.get("policy_inode") or info.st_dev != receipt.get("policy_device")):
        fail("Transient policy changed; refusing to remove any non-owned system policy")
    POLICY_PATH.unlink()  # Only our exact O_EXCL-created policy; never app/network data.


def _apt_configuration(work, codename):
    # APT_CONFIG is read BEFORE system apt.conf.d/main. These first two settings
    # prevent inherited root hooks/source/preferences from entering this run.
    for name in ("empty-parts", "source-parts", "trusted-parts", "preferences-parts", "lists", "archives"):
        ensure_dir(work / name, 0o755)
    for name in ("empty-parts", "source-parts", "trusted-parts", "preferences-parts"):
        if any((work / name).iterdir()):
            fail("Private APT configuration isolation directory is not empty; foreign hooks/sources refused")
    write_new(work / "empty.conf", b"// intentionally empty\n", 0o644)
    write_new(work / "preferences", b"# no package pinning\n", 0o644)
    sources = (f"deb [arch=amd64 signed-by={APT_KEYRING}] https://archive.ubuntu.com/ubuntu {codename} main universe\n"
               f"deb [arch=amd64 signed-by={APT_KEYRING}] https://archive.ubuntu.com/ubuntu {codename}-updates main universe\n"
               f"deb [arch=amd64 signed-by={APT_KEYRING}] https://security.ubuntu.com/ubuntu {codename}-security main universe\n")
    write_new(work / "sources.list", sources.encode(), 0o644)
    config = (f'Dir::Etc::parts "{work}/empty-parts";\nDir::Etc::main "{work}/empty.conf";\n'
              f'Dir::Etc::sourcelist "{work}/sources.list";\nDir::Etc::sourceparts "{work}/source-parts";\n'
              f'Dir::Etc::preferences "{work}/preferences";\nDir::Etc::preferencesparts "{work}/preferences-parts";\n'
              f'Dir::Etc::trusted "{APT_KEYRING}";\nDir::Etc::trustedparts "{work}/trusted-parts";\n'
              f'Dir::State::lists "{work}/lists";\nDir::Cache::archives "{work}/archives";\n'
              'APT::Get::AllowUnauthenticated "false";\nAcquire::AllowInsecureRepositories "false";\n'
              'Acquire::AllowDowngradeToInsecureRepositories "false";\nAcquire::https::Verify-Peer "true";\n'
              'Acquire::https::Verify-Host "true";\nAcquire::Check-Valid-Until "true";\nAcquire::Check-Date "true";\n'
              'DPkg::Options { "--force-confold"; };\n')
    write_new(work / "apt.conf", config.encode(), 0o644)
    return str(work / "apt.conf")


def install_dependencies(component, state_dir, *, with_mysql=False, resume=False):
    plan = dependency_plan(component, with_mysql)
    codename = root_target()
    for executable in (APT_GET, SYSTEMCTL):
        protected_path(executable)
    protected_path(str(APT_KEYRING))
    state_dir = ensure_dir(Path(state_dir))
    path = state_dir / "dependencies.json"
    if path.exists():
        if not resume:
            fail("Dependency receipt exists; explicitly resume the original package plan")
        receipt = _json(read_private(str(path)))
        if receipt.get("component") != component or receipt.get("with_mysql") != with_mysql or receipt.get("codename") != codename:
            fail("Dependency resume plan changed")
    else:
        if POLICY_PATH.exists() or POLICY_PATH.is_symlink():
            fail("Existing policy-rc.d is never replaced, even temporarily")
        fresh_dependency_host(component)
        if with_mysql:
            _fresh_mysql_host()
        receipt = {"schema": 1, "component": component, "with_mysql": with_mysql,
                   "codename": codename, "policy_nonce": secrets.token_hex(32), "steps": []}
        save_receipt(path, receipt)
    if receipt.get("status") == "dependencies-installed":
        return {"status": "dependencies-installed", "receipt": str(path), "node_daemon_included": False}
    work = ensure_dir(APT_WORK_ROOT / component, 0o755)
    config = _apt_configuration(work, codename)
    env = dict(SAFE_ENV, APT_CONFIG=config, DEBIAN_FRONTEND="noninteractive", NEEDRESTART_MODE="l")
    if "policy-created" not in receipt["steps"]:
        if POLICY_PATH.exists() or POLICY_PATH.is_symlink():
            fail("Another service policy appeared; refusing to replace it")
        write_new(POLICY_PATH, _policy_bytes(receipt["policy_nonce"]), 0o755)
        info = POLICY_PATH.lstat()
        receipt.update(policy_inode=info.st_ino, policy_device=info.st_dev)
        receipt["steps"].append("policy-created")
        save_receipt(path, receipt)
    else:
        # A failed transaction retains its blocking policy until explicit resume.
        protected_path(str(POLICY_PATH))
        info = POLICY_PATH.lstat()
        if (POLICY_PATH.read_bytes() != _policy_bytes(receipt["policy_nonce"]) or stat.S_IMODE(info.st_mode) != 0o755 or
                info.st_ino != receipt.get("policy_inode") or info.st_dev != receipt.get("policy_device")):
            fail("Owned package-start policy missing or changed; manual review required")
    try:
        run_fixed([APT_GET, "update"], env=env, timeout=600)
        arguments = ["--no-install-recommends", "--no-upgrade", "--no-remove", "install", *plan["packages"]]
        simulation = run_fixed([APT_GET, "--simulate", *arguments], env=env).decode("utf-8")
        for line in simulation.splitlines():
            if (line.startswith("Remv ") or re.match(r"^Inst \S+ \[", line) or
                    re.match(r"^Inst (?:libvirt-daemon\S*|libvirt-daemon-config-network|firewalld|ufw|openvswitch\S*)\b", line)):
                fail("APT plan would upgrade/remove existing software or install unapproved network daemons")
        receipt["status"] = "package-transaction-pending"
        save_receipt(path, receipt)
        run_fixed([APT_GET, "--assume-yes", *arguments], env=env, timeout=1200)
        if "packages-installed" not in receipt["steps"]:
            receipt["steps"].append("packages-installed")
        if with_mysql:
            # Only a fresh dedicated service gets this owned local-only drop-in.
            # No global MySQL configuration, root password or existing unit edited.
            ensure_dir(MYSQL_DROPIN.parent, 0o755)
            write_new(MYSQL_DROPIN, MYSQL_LOCAL_DROPIN, 0o644)
        _remove_owned_policy(receipt)
        receipt["status"] = "dependencies-installed"
        save_receipt(path, receipt)
        return {"status": "dependencies-installed", "receipt": str(path), "node_daemon_included": False}
    except Exception:
        receipt["status"] = "failed-package-transaction-review-required"
        save_receipt(path, receipt)
        raise


def start_owned_mysql(state_dir):
    """Start only the exact fresh service prepared by this package operation."""
    state_dir = Path(state_dir)
    receipt_path = state_dir / "dependencies.json"
    receipt = _json(read_private(str(receipt_path)))
    if (receipt.get("status") != "dependencies-installed" or receipt.get("component") != "controller" or
            receipt.get("with_mysql") is not True):
        fail("Only this operation's newly installed dedicated MySQL may be started")
    protected_path(str(MYSQL_DROPIN))
    if MYSQL_DROPIN.read_bytes() != MYSQL_LOCAL_DROPIN:
        fail("Owned socket-only MySQL unit policy changed; refusing start")
    run_fixed([SYSTEMCTL, "daemon-reload"])
    try:
        run_fixed([SYSTEMCTL, "start", "mysql.service"])
        run_fixed([SYSTEMCTL, "is-active", "--quiet", "mysql.service"])
        for attempt in range(10):
            try:
                info = _query(state_dir,
                    "SELECT JSON_OBJECT('tcp_disabled',@@skip_networking,'mysqlx_enabled',"
                    "(SELECT COUNT(*) FROM information_schema.PLUGINS WHERE PLUGIN_NAME='mysqlx' AND PLUGIN_STATUS='ACTIVE'));\n")
                if info.get("tcp_disabled") not in (1, True) or info.get("mysqlx_enabled") != 0:
                    fail("Dedicated MySQL must have both classic and X TCP listeners disabled")
                receipt["mysql_transport"] = "unix-socket-only-verified"
                save_receipt(receipt_path, receipt)
                return {"status": "dedicated-mysql-local-ready", "transport": "unix-socket-only"}
            except ProvisionError:
                if attempt == 9:
                    raise
                time.sleep(1)
    except Exception:
        try:
            run_fixed([SYSTEMCTL, "stop", "mysql.service"])
        except ProvisionError:
            pass
        raise


def validate_names(database, runtime_user, migration_user):
    if (not isinstance(database, str) or not re.fullmatch(r"aster_(?:cloud|controller)(?:_[a-z0-9]{1,32})?", database) or
            any(not isinstance(user, str) or not re.fullmatch(r"aster_[a-z0-9_]{1,25}", user)
                for user in (runtime_user, migration_user)) or runtime_user == migration_user):
        fail("Dedicated safe Aster DB plus distinct non-root Aster account names required")
    return database, runtime_user, migration_user


def mysql_sql(state_dir, sql):
    """Local root socket bootstrap only, no implicit option/login files or history."""
    protected_path(MYSQL)
    home = ensure_dir(Path(state_dir) / "mysql-client-home")
    login = home / ".disabled-login-path"
    if login.exists() or login.is_symlink():
        fail("Unexpected MySQL login-path file refused")
    env = dict(SAFE_ENV, HOME=str(home), MYSQL_TEST_LOGIN_FILE=str(login), MYSQL_HISTFILE="/dev/null")
    return run_fixed([MYSQL, "--no-defaults", "--protocol=SOCKET", "--socket=" + MYSQL_SOCKET, "--user=root",
                      "--batch", "--raw", "--skip-column-names", "--skip-reconnect", "--connect-timeout=5", "--binary-mode"],
                     stdin=sql.encode("utf-8"), env=env)


def _query(state_dir, sql):
    try:
        return _json(mysql_sql(state_dir, sql).decode("utf-8"))
    except (UnicodeError, ValueError):
        fail("Unexpected local MySQL provisioning response")


def verify_grants(state_dir, user, database, privileges):
    """Refuse implicit roles/global/DDL extras rather than revoking existing grants."""
    account = "`" + user + "`@`localhost`"
    target = "`" + database.replace("_", "\\_") + "`.*"
    lines = mysql_sql(state_dir, "SHOW GRANTS FOR '" + user + "'@'localhost';\n").decode("utf-8").splitlines()
    seen = False
    for line in lines:
        if line == "GRANT USAGE ON *.* TO " + account:
            continue
        match = re.fullmatch(r"GRANT ([A-Z, ]+) ON " + re.escape(target) + r" TO " + re.escape(account), line)
        if not match or set(match[1].split(", ")) != set(privileges):
            fail("Provisioned account has unexpected global/schema/role/grant-option privileges; never altered to hide mismatch")
        seen = True
    if not seen:
        fail("Expected exact dedicated account privileges were not confirmed")


def provision_mysql(state_dir, database, runtime_user, migration_user, *, resume=False):
    root_target()
    validate_names(database, runtime_user, migration_user)
    state_dir = ensure_dir(Path(state_dir))
    receipt_path = state_dir / "mysql-provision.json"
    request = {"database": database, "runtime_user": runtime_user, "migration_user": migration_user}
    receipt = _json(read_private(str(receipt_path))) if receipt_path.exists() else None
    if receipt and (not resume or any(receipt.get(k) != v for k, v in request.items())):
        fail("Dedicated MySQL receipt exists; explicitly resume the original names")
    # No password is requested/generated/written before these collision checks.
    info = _query(state_dir,
        "SELECT JSON_OBJECT('current_user',CURRENT_USER(),'version',VERSION(),'server_uuid',@@server_uuid,"
        "'partial_revokes',@@partial_revokes,'mandatory_roles',@@mandatory_roles,'db_exists',(SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='" + database + "'),"
        "'foreign_databases',(SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('mysql','sys','information_schema','performance_schema','" + database + "')),"
        "'runtime_exists',(SELECT COUNT(*) FROM mysql.user WHERE User='" + runtime_user + "'),"
        "'migration_exists',(SELECT COUNT(*) FROM mysql.user WHERE User='" + migration_user + "'));\n")
    if (info.get("current_user") != "root@localhost" or not isinstance(info.get("version"), str) or
            not re.match(r"8\.(?:0\.(?:2[1-9]|[3-9][0-9])|4\.[0-9]+)", info["version"]) or
            info.get("partial_revokes") not in (0, False) or info.get("foreign_databases") != 0 or
            info.get("mandatory_roles", "") or
            not isinstance(info.get("server_uuid"), str) or not re.fullmatch(r"[a-fA-F0-9-]{36}", info["server_uuid"])):
        fail("Dedicated MySQL 8.0.21+/8.4 local-root server with no foreign DBs and standard grant semantics required")
    if receipt is None:
        if any(info.get(key) != 0 for key in ("db_exists", "runtime_exists", "migration_exists")):
            fail("Database or account already exists; refusing any adoption/overwrite")
        receipt = {"schema": 1, **request, "server_uuid": info["server_uuid"], "nonce": secrets.token_hex(32), "steps": []}
        save_receipt(receipt_path, receipt)
    elif receipt.get("server_uuid") != info["server_uuid"]:
        fail("MySQL server identity changed; resume refused")
    nonce = receipt["nonce"]
    if not re.fullmatch(r"[0-9a-f]{64}", nonce):
        fail("Invalid MySQL ownership receipt")
    def persist(step):
        if step not in receipt["steps"]:
            receipt["steps"].append(step)
        save_receipt(receipt_path, receipt)
    try:
        if info["db_exists"]:
            owner = _query(state_dir, "SELECT JSON_OBJECT('nonce',nonce,'server_uuid',server_uuid) FROM `" + database + "`.aster_installer_ownership WHERE id=1;\n")
            if owner != {"nonce": nonce, "server_uuid": receipt["server_uuid"]}:
                fail("Existing DB lacks this operation's exact ownership marker; never adopted")
        else:
            if "database-created" in receipt["steps"]:
                fail("Previously owned DB disappeared; never recreated automatically")
            mysql_sql(state_dir, "CREATE DATABASE `" + database + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n"
                "CREATE TABLE `" + database + "`.aster_installer_ownership (id INT PRIMARY KEY,nonce CHAR(64) NOT NULL,server_uuid CHAR(36) NOT NULL);\n"
                "INSERT INTO `" + database + "`.aster_installer_ownership VALUES (1,'" + nonce + "','" + receipt["server_uuid"] + "');\n")
        persist("database-created")
        result = {"database_name": database}
        for role, user, exists, privileges in (
                ("runtime", runtime_user, info["runtime_exists"], RUNTIME_PRIVILEGES),
                ("migration", migration_user, info["migration_exists"], MIGRATION_PRIVILEGES)):
            dsn_path = state_dir / (role + "-mysql-dsn")
            if exists:
                owner = _query(state_dir, "SELECT JSON_OBJECT('nonce',ATTRIBUTE->>'$.aster_cloud_installer','host',HOST) FROM information_schema.USER_ATTRIBUTES WHERE USER='" + user + "';\n")
                if owner != {"nonce": nonce, "host": "localhost"} or not dsn_path.exists():
                    fail("Existing account is foreign or CREATE acknowledgement/credential was lost; no reset/overwrite")
                read_private(str(dsn_path))
            else:
                if role + "-created" in receipt["steps"] or dsn_path.exists():
                    fail("Account/credential state is ambiguous; never recreate or reset it automatically")
                # Server-generated passwords never occur in submitted SQL (nor
                # argv/env/client history). Capture the one-time response privately.
                raw = mysql_sql(state_dir, "CREATE USER '" + user + "'@'localhost' IDENTIFIED WITH caching_sha2_password BY RANDOM PASSWORD ATTRIBUTE '{\"aster_cloud_installer\":\"" + nonce + "\"}';\n")
                values = raw.decode("utf-8").rstrip("\n").split("\t")
                if (len(values) not in (3, 4) or len(values) == 4 and values[3] != "1" or
                        values[:2] != [user, "localhost"] or not 16 <= len(values[2]) <= 1024 or
                        any(c in values[2] for c in "\r\n\t\x00")):
                    fail("Random password acknowledgement ambiguous; retain DB/account for manual recovery")
                write_new(dsn_path, (user + ":" + values[2] + "@unix(" + MYSQL_SOCKET + ")/" + database + "\n").encode())
                del raw, values
            persist(role + "-created")
            # Escape database underscores: MySQL otherwise treats them as grant
            # wildcards even inside backticks. partial_revokes=1 is refused above.
            grant_database = database.replace("_", "\\_")
            mysql_sql(state_dir, "GRANT " + ", ".join(privileges) + " ON `" + grant_database + "`.* TO '" + user + "'@'localhost';\n")
            verify_grants(state_dir, user, database, privileges)
            persist(role + "-granted")
            result["dsn_file" if role == "runtime" else "migration_dsn_file"] = str(dsn_path)
        receipt["status"] = "dedicated-database-provisioned"
        save_receipt(receipt_path, receipt)
        return result
    except Exception:
        receipt["status"] = "failed-preserved-no-drop-no-reset"
        save_receipt(receipt_path, receipt)
        raise
