#!/usr/bin/env python3
"""Offline lifecycle tests with fake executables; not real MySQL acceptance."""
import hashlib
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import tarfile
import tempfile
import textwrap
import time
import unittest

SCRIPT = Path(__file__).with_name("mysql-native.sh").resolve()
MANIFEST = SCRIPT.with_name("mysql-distribution.json")


def executable(path, source):
    path.write_text(textwrap.dedent(source), encoding="utf-8")
    path.chmod(0o700)


class NativeMySQLFixtureTest(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix="aster-native-test-")
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name)
        self.controller = self.root / "controller with spaces"
        self.controller.mkdir()
        self.script = self.controller / SCRIPT.name
        self.script.write_bytes(SCRIPT.read_bytes())
        self.runner = self.root / "runner"
        self.runner.mkdir()
        self.fake_bin = self.root / "tools"
        self.fake_bin.mkdir()
        executable(self.fake_bin / "curl", '''\
            #!/usr/bin/env python3
            import os
            from pathlib import Path
            Path(os.environ['CI_FIXTURE_DOWNLOAD']).write_text('attempted')
            raise SystemExit(22)
        ''')
        self.real_timeout = shutil.which("timeout")
        self.assertIsNotNone(self.real_timeout)
        executable(self.fake_bin / "timeout", '''\
            #!/usr/bin/env python3
            import os
            import sys
            args = sys.argv[1:]
            assert args[:2] in (['--signal=TERM', '--kill-after=1s'], ['--signal=TERM', '--kill-after=5s'])
            if '--initialize-insecure' in args and os.environ.get('CI_FIXTURE_INIT_HANG'):
                assert args[2] == '120s'
                args[2] = '0.2s'
            os.execv(os.environ['CI_FIXTURE_REAL_TIMEOUT'], ['timeout'] + args)
        ''')
        distribution = self.root / "fake-mysql"
        (distribution / "bin").mkdir(parents=True)
        executable(distribution / "bin/mysqld", '''\
            #!/usr/bin/env python3
            import os
            from pathlib import Path
            import signal
            import sys
            import time
            assert sys.argv[1] == '--no-defaults'
            assert 'MYSQL_PWD' not in os.environ
            assert 'MYSQL_TEST_LOGIN_FILE' not in os.environ
            assert 'ASTER_MYSQL_TEST_DSN' not in os.environ
            with open(os.environ['CI_FIXTURE_EVENTS'], 'a') as output:
                output.write('mysqld ' + ('version' if '--version' in sys.argv else 'initialize' if '--initialize-insecure' in sys.argv else 'serve') + '\\n')
            if '--version' in sys.argv:
                print('mysqld Ver ' + os.environ.get('CI_FIXTURE_BINARY_VERSION', '8.4.11') + ' for Linux on x86_64')
                raise SystemExit(0)
            if '--initialize-insecure' in sys.argv:
                if os.environ.get('CI_FIXTURE_INIT_HANG'):
                    Path(os.environ['CI_FIXTURE_INIT_PID']).write_text(str(os.getpid()))
                    time.sleep(30)
                raise SystemExit(2 if os.environ.get('CI_FIXTURE_INIT_FAIL') else 0)
            assert '--bind-address=127.0.0.1' in sys.argv
            assert '--mysqlx=0' in sys.argv
            assert '--skip-name-resolve' in sys.argv
            init = Path(next(arg.split('=', 1)[1] for arg in sys.argv if arg.startswith('--init-file=')))
            assert "ALTER USER 'root'@'localhost' ACCOUNT LOCK;" in init.read_text()
            assert init.stat().st_mode & 0o777 == 0o600
            Path(os.environ['CI_FIXTURE_MYSQL_PID']).write_text(str(os.getpid()))
            if os.environ.get('CI_FIXTURE_START_FAIL'):
                raise SystemExit(2)
            def stop(*_):
                raise SystemExit(0)
            signal.signal(signal.SIGTERM, stop)
            while True:
                time.sleep(0.05)
        ''')
        executable(distribution / "bin/mysql", '''\
            #!/usr/bin/env python3
            import os
            from pathlib import Path
            import sys
            import time
            assert sys.argv[1:3] == ['--no-defaults', '--no-login-paths']
            assert '--host=127.0.0.1' in sys.argv and '--user=aster_ci' in sys.argv
            assert os.environ['MYSQL_PWD'] == 'AsterCiFixtureOnly2026'
            assert 'MYSQL_TEST_LOGIN_FILE' not in os.environ
            if not Path(os.environ['CI_FIXTURE_MYSQL_PID']).exists():
                raise SystemExit(1)
            if os.environ.get('CI_FIXTURE_QUERY_HANG_ONCE'):
                marker = Path(os.environ['CI_FIXTURE_QUERY_PID'])
                if not marker.exists():
                    marker.write_text(str(os.getpid()))
                    time.sleep(30)
            print(os.environ.get('CI_FIXTURE_SERVER_VERSION', '8.4.11'))
        ''')
        self.archive = self.root / "offline archive.tar.xz"
        with tarfile.open(self.archive, "w:xz") as archive:
            archive.add(distribution, arcname="mysql-fixture")
        self.manifest = json.loads(MANIFEST.read_text())
        self.manifest.update(status="verified", sha256=hashlib.sha256(self.archive.read_bytes()).hexdigest(),
                             verification_note="TEST FIXTURE ONLY: fake executables, not an Oracle archive")
        self.write_manifest()
        self.child = self.root / "child.py"
        executable(self.child, '''\
            #!/usr/bin/env python3
            import os
            from pathlib import Path
            import re
            import sys
            import time
            import subprocess
            assert re.fullmatch(r'aster_ci:AsterCiFixtureOnly2026@tcp\\(127\\.0\\.0\\.1:[0-9]+\\)/aster_ci_test\\?parseTime=true', os.environ['ASTER_MYSQL_TEST_DSN'])
            assert 'MYSQL_PWD' not in os.environ
            assert 'MYSQL_TEST_LOGIN_FILE' not in os.environ
            Path(os.environ['CI_FIXTURE_CHILD_PID']).write_text(str(os.getpid()))
            if os.environ.get('CI_FIXTURE_BACKGROUND'):
                source = 'import time; time.sleep(30)'
                if os.environ.get('CI_FIXTURE_BACKGROUND') == 'ignore-term':
                    source = 'import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(30)'
                descendant = subprocess.Popen([sys.executable, '-c', source])
                Path(os.environ['CI_FIXTURE_BACKGROUND_PID']).write_text(str(descendant.pid))
                time.sleep(0.1)
            while os.environ.get('CI_FIXTURE_CHILD_WAIT'):
                time.sleep(0.05)
            raise SystemExit(int(os.environ.get('CI_FIXTURE_CHILD_EXIT', '0')))
        ''')
        self.env = dict(os.environ)
        self.env.update({
            "PATH": str(self.fake_bin) + os.pathsep + os.environ["PATH"],
            "RUNNER_TEMP": str(self.runner),
            "CI_FIXTURE_EVENTS": str(self.root / "events"),
            "CI_FIXTURE_DOWNLOAD": str(self.root / "download"),
            "CI_FIXTURE_MYSQL_PID": str(self.root / "mysql.pid"),
            "CI_FIXTURE_CHILD_PID": str(self.root / "child.pid"),
            "CI_FIXTURE_BACKGROUND_PID": str(self.root / "background.pid"),
            "CI_FIXTURE_INIT_PID": str(self.root / "initialize.pid"),
            "CI_FIXTURE_QUERY_PID": str(self.root / "query.pid"),
            "CI_FIXTURE_REAL_TIMEOUT": self.real_timeout,
            "MYSQL_PWD": "inherited-must-not-escape",
            "MYSQL_TEST_LOGIN_FILE": "inherited-must-not-escape",
            "ASTER_MYSQL_TEST_DSN": "inherited-must-not-escape",
        })

    def write_manifest(self):
        (self.controller / MANIFEST.name).write_text(json.dumps(self.manifest), encoding="utf-8")

    def command(self, script=None, offline=True):
        command = ["bash", str(script or self.script)]
        if offline:
            command += ["--archive", str(self.archive)]
        return command + ["--", str(self.child)]

    def run_fixture(self, script=None, offline=True, **overrides):
        result = subprocess.run(self.command(script, offline), cwd=self.root,
                                env=dict(self.env, **overrides), text=True,
                                capture_output=True, timeout=20)
        self.assert_clean(result)
        return result

    def assert_clean(self, result):
        self.assertEqual(list(self.runner.iterdir()), [], "fixture left temporary state")
        self.assertNotIn("inherited-must-not-escape", result.stdout + result.stderr)
        self.assertNotIn("AsterCiFixtureOnly2026", result.stdout + result.stderr)
        for name in ("mysql.pid", "child.pid", "initialize.pid", "query.pid", "background.pid"):
            pid = self.root / name
            if pid.exists():
                process = Path("/proc") / pid.read_text() / "stat"
                try:
                    state = process.read_text().rsplit(")", 1)[1].split()[0]
                except FileNotFoundError:
                    continue
                self.assertEqual(state, "Z", f"owned {name} still running")

    def test_repository_manifest_blocks_before_download_or_execution(self):
        result = self.run_fixture(script=SCRIPT, offline=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("awaiting verified provenance and SHA-256", result.stderr)
        self.assertFalse((self.root / "download").exists())
        self.assertFalse((self.root / "events").exists())

    def test_verified_status_without_checksum_still_blocks(self):
        self.manifest["sha256"] = None
        self.write_manifest()
        result = self.run_fixture(offline=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("SHA-256 is required", result.stderr)
        self.assertFalse((self.root / "download").exists())

    def test_download_refusal_stops_without_execution(self):
        result = self.run_fixture(offline=False)
        self.assertEqual(result.returncode, 22)
        self.assertTrue((self.root / "download").exists())
        self.assertFalse((self.root / "events").exists())

    def test_checksum_mismatch_stops_before_execution(self):
        self.manifest["sha256"] = "a" * 64
        self.write_manifest()
        result = self.run_fixture()
        self.assertEqual(result.returncode, 1)
        self.assertIn("SHA-256 mismatch", result.stderr)
        self.assertFalse((self.root / "events").exists())

    def test_wrong_binary_version_stops_before_initialization(self):
        result = self.run_fixture(CI_FIXTURE_BINARY_VERSION="8.0.44")
        self.assertEqual(result.returncode, 1)
        self.assertIn("version does not match", result.stderr)
        self.assertEqual((self.root / "events").read_text(), "mysqld version\n")

    def test_initialization_failure_stops_without_child(self):
        result = self.run_fixture(CI_FIXTURE_INIT_FAIL="1")
        self.assertEqual(result.returncode, 1)
        self.assertIn("initialization failed", result.stderr)
        self.assertFalse((self.root / "mysql.pid").exists())
        self.assertFalse((self.root / "child.pid").exists())

    def test_startup_exit_stops_without_child(self):
        result = self.run_fixture(CI_FIXTURE_START_FAIL="1")
        self.assertEqual(result.returncode, 1)
        self.assertIn("owned native MySQL", result.stderr)
        self.assertFalse((self.root / "child.pid").exists())

    def test_hung_initialization_is_bounded_and_stopped(self):
        result = self.run_fixture(CI_FIXTURE_INIT_HANG="1")
        self.assertEqual(result.returncode, 1)
        self.assertIn("initialization failed", result.stderr)
        self.assertTrue((self.root / "initialize.pid").exists())
        self.assertFalse((self.root / "child.pid").exists())

    def test_hung_readiness_query_times_out_and_can_retry(self):
        result = self.run_fixture(CI_FIXTURE_QUERY_HANG_ONCE="1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.root / "query.pid").exists())

    def test_wrong_running_version_stops_owned_server(self):
        result = self.run_fixture(CI_FIXTURE_SERVER_VERSION="8.0.44")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Running MySQL version does not match", result.stderr)
        self.assertTrue((self.root / "mysql.pid").exists())
        self.assertFalse((self.root / "child.pid").exists())

    def test_success_scrubs_inherited_settings_and_stops_owned_server(self):
        result = self.run_fixture()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("fixture checks passed", result.stdout)
        self.assertTrue((self.root / "mysql.pid").exists())
        self.assertTrue((self.root / "child.pid").exists())

    def test_child_failure_preserves_exit_status_and_cleans_up(self):
        result = self.run_fixture(CI_FIXTURE_CHILD_EXIT="7")
        self.assertEqual(result.returncode, 7)
        self.assertNotIn("fixture checks passed", result.stdout)
        self.assertTrue((self.root / "mysql.pid").exists())

    def test_background_descendant_is_stopped_after_command_exits(self):
        result = self.run_fixture(CI_FIXTURE_BACKGROUND="normal")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.root / "background.pid").exists())

    def test_background_descendant_ignoring_term_is_killed(self):
        result = self.run_fixture(CI_FIXTURE_BACKGROUND="ignore-term")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue((self.root / "background.pid").exists())

    def test_termination_stops_owned_command_and_server(self):
        process = subprocess.Popen(self.command(), cwd=self.root,
                                   env=dict(self.env, CI_FIXTURE_CHILD_WAIT="1"),
                                   text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 10
            while not (self.root / "child.pid").exists():
                if process.poll() is not None or time.monotonic() >= deadline:
                    self.fail("fixture command did not start")
                time.sleep(0.02)
            process.send_signal(signal.SIGTERM)
            stdout, stderr = process.communicate(timeout=15)
            self.assertEqual(process.returncode, 143, stdout + stderr)
            self.assert_clean(subprocess.CompletedProcess(process.args, process.returncode, stdout, stderr))
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
