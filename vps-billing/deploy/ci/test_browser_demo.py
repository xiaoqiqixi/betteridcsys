#!/usr/bin/env python3
"""Guard and lifecycle tests using fake Go/Node tools; never launches a browser."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from unittest import mock

SCRIPT = Path(__file__).with_name("browser-demo.py").resolve()
SPEC = importlib.util.spec_from_file_location("browser_demo", SCRIPT)
browser_demo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(browser_demo)
PNG = b"\x89PNG\r\n\x1a\nsynthetic-fixture"


def executable(path, source):
    path.write_text(textwrap.dedent(source), encoding="utf-8")
    path.chmod(0o700)


def wait_for(path, process, timeout=12):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists():
            return
        if process.poll() is not None:
            raise AssertionError("Fixture helper exited before readiness")
        time.sleep(0.02)
    raise AssertionError("Fixture readiness timed out")


class BrowserDemoTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="aster-browser-helper-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.repo = self.root / "source checkout"
        frontend = self.repo / "vps-billing/frontend"
        backend = self.repo / "vps-billing/backend"
        for directory in (backend, frontend / "dist", frontend / "tests", frontend / "node_modules/vite/bin"):
            directory.mkdir(parents=True)
        (backend / "go.mod").write_text("module fixture.invalid/test\n")
        (frontend / "dist/index.html").write_text("synthetic frontend\n")
        (frontend / "tests/e2e.mjs").write_text('const config={chromiumSandbox: true}; await shot("fixture");\n')
        (frontend / "node_modules/vite/bin/vite.js").write_text("// fixture\n")
        self.chrome = self.root / "trusted-chrome"
        executable(self.chrome, "#!/bin/sh\nexit 99\n")
        self.output = self.root / "new-evidence"
        self.tools = self.root / "tools"
        self.tools.mkdir()
        self.mode = self.root / "mode"
        self.mode.write_text("success")
        self.api_script = self.root / "api.py"
        self.api_pid = self.root / "api.pid"
        self.preview_pid = self.root / "preview.pid"
        self.browser_pid = self.root / "browser.pid"
        self.detached_pid = self.root / "detached.pid"
        self.temporary = self.root / "private-temporary"
        self.temporary.mkdir()
        common = f'''
            import json, os, sys, time
            from pathlib import Path
            assert os.environ.get('HOME') == {os.environ.get('HOME')!r}
            for name in ('MYSQL_DSN', 'ASTER_MYSQL_TEST_DSN', 'SMTP_ENCRYPTION_KEY_FILE',
                         'GITHUB_TOKEN', 'GH_TOKEN', 'NODE_OPTIONS', 'HTTP_PROXY',
                         'TEST_ADMIN_PASSWORD', 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'):
                assert name not in os.environ, name
        '''
        executable(self.api_script, "#!/usr/bin/env python3\n" + textwrap.dedent(common) + textwrap.dedent(f'''
            from http.server import BaseHTTPRequestHandler, HTTPServer
            assert os.environ['APP_MODE']=='demo'
            assert os.environ['EMAIL_PROVIDER']=='email.disabled'
            assert os.environ['PAYMENT_PROVIDER']=='payment.disabled'
            assert 'SESSION_SECRET' not in os.environ
            Path({str(self.api_pid)!r}).write_text(str(os.getpid()))
            class Handler(BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(200); self.end_headers()
                    self.wfile.write(json.dumps({{'data':{{'status':'ready','demo_mode':True}}}}).encode())
                def log_message(self,*args):pass
            host,port=os.environ['LISTEN_ADDR'].rsplit(':',1)
            assert host=='127.0.0.1'
            HTTPServer((host,int(port)),Handler).serve_forever()
        '''))
        executable(self.tools / "go", "#!/usr/bin/env python3\n" + textwrap.dedent(common) + textwrap.dedent(f'''
            import shutil
            assert os.environ['GOENV']=='off' and os.environ['GOPROXY']=='off'
            assert '-mod=readonly' in sys.argv
            assert 'APP_MODE' not in os.environ
            if Path({str(self.mode)!r}).read_text()=='build-fail':sys.exit(9)
            target=Path(sys.argv[sys.argv.index('-o')+1])
            shutil.copyfile({str(self.api_script)!r},target);target.chmod(0o700)
        '''))
        executable(self.tools / "git", "#!/usr/bin/env python3\n" + textwrap.dedent(f'''
            import sys
            from pathlib import Path
            if sys.argv[1]=='rev-parse':
                print({'a'*40!r})
            else:
                assert sys.argv[1:]==['status','--porcelain','--untracked-files=normal']
                if Path({str(backend/'untracked.go')!r}).exists():
                    print('?? vps-billing/backend/untracked.go')
        '''))
        executable(self.tools / "node", "#!/usr/bin/env python3\n" + textwrap.dedent(common) + textwrap.dedent(f'''
            import subprocess
            if sys.argv[1].endswith('vite.js'):
                from http.server import BaseHTTPRequestHandler,HTTPServer
                import urllib.request
                assert sys.argv[2]=='preview' and '--strictPort' in sys.argv
                config=Path(sys.argv[sys.argv.index('--config')+1]).read_text()
                config=json.loads(config.removeprefix('export default ').strip().removesuffix(';'))
                assert config['envDir'] is False
                preview=config['preview']; assert preview['host']=='127.0.0.1'
                assert preview['proxy']['/api']['changeOrigin'] is False
                target=preview['proxy']['/api']['target']
                assert int(target.rsplit(':',1)[1]) != preview['port']
                Path({str(self.preview_pid)!r}).write_text(str(os.getpid()))
                class Handler(BaseHTTPRequestHandler):
                    def do_GET(self):
                        with urllib.request.build_opener(urllib.request.ProxyHandler({{}})).open(target+self.path) as response:
                            raw=response.read()
                        self.send_response(200);self.end_headers();self.wfile.write(raw)
                    def log_message(self,*args):pass
                HTTPServer(('127.0.0.1',preview['port']),Handler).serve_forever()
            assert sys.argv[1].endswith('e2e.mjs')
            assert os.environ['CHROMIUM_PATH']=={str(self.chrome)!r}
            assert os.environ['TEST_BASE_URL'].startswith('http://127.0.0.1:')
            assert 'APP_MODE' not in os.environ
            Path({str(self.browser_pid)!r}).write_text(str(os.getpid()))
            mode=Path({str(self.mode)!r}).read_text()
            if mode=='sandbox-fail':
                print('No usable sandbox!');sys.exit(6)
            if mode=='assertion-fail':
                print('Error: synthetic assertion expected a visible button');sys.exit(7)
            child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(120)'],start_new_session=True)
            Path({str(self.detached_pid)!r}).write_text(str(child.pid))
            if mode=='interrupt':time.sleep(120)
            time.sleep(0.1)
            output=Path(os.environ['E2E_OUTPUT_DIR']);output.mkdir()
            (output/'fixture.png').write_bytes({PNG!r})
        '''))
        self.env = dict(os.environ, PATH=str(self.tools) + os.pathsep + os.environ["PATH"], TMPDIR=str(self.temporary))
        for name in ("MYSQL_DSN", "ASTER_MYSQL_TEST_DSN", "SMTP_ENCRYPTION_KEY_FILE", "GITHUB_TOKEN", "GH_TOKEN",
                     "NODE_OPTIONS", "HTTP_PROXY", "TEST_ADMIN_PASSWORD", "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH",
                     "APP_MODE", "SESSION_SECRET", "PAYMENT_PROVIDER", "EMAIL_PROVIDER"):
            self.env[name] = "must-not-reach-demo"

    def command(self):
        return [sys.executable, "-I", str(SCRIPT), "--repo-root", str(self.repo), "--output", str(self.output), "--chromium-path", str(self.chrome)]

    def run_helper(self):
        result = subprocess.run(self.command(), env=self.env, capture_output=True, text=True, timeout=25)
        summary = json.loads((self.output / "summary.json").read_text())
        self.assertEqual(summary["cleanup"], True, result.stdout + result.stderr)
        self.assertEqual(list(self.temporary.iterdir()), [])
        for marker in (self.api_pid, self.preview_pid, self.browser_pid, self.detached_pid):
            if marker.exists():
                self.assertFalse(Path('/proc/' + marker.read_text()).exists(), marker.name)
        self.assertNotIn("must-not-reach-demo", result.stdout + result.stderr)
        return result, summary

    def test_success_cleans_detached_descendant_and_keeps_only_synthetic_evidence(self):
        foreign = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(30)"])
        def stop_foreign():
            if foreign.poll() is None:
                foreign.terminate()
            foreign.wait(timeout=5)
        self.addCleanup(stop_foreign)
        result, summary = self.run_helper()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(summary["passed"])
        self.assertEqual(summary["source_commit"], "a" * 40)
        self.assertEqual(summary["stage"], "complete")
        self.assertEqual({p.name for p in self.output.iterdir()}, {"summary.json", "screenshots"})
        self.assertEqual((self.output / "screenshots/fixture.png").read_bytes(), PNG)
        self.assertIsNone(foreign.poll(), "unrelated process was terminated")
        foreign.terminate();foreign.wait(timeout=5)

    def test_sandbox_failure_never_falls_back(self):
        self.mode.write_text("sandbox-fail")
        result, summary = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertFalse(summary["passed"])
        self.assertEqual(summary["stage"], "browser")
        self.assertIn("no sandbox bypass", summary["reason"])
        self.assertFalse((self.output / "screenshots").exists())

    def test_build_failure_starts_no_demo_or_browser(self):
        self.mode.write_text("build-fail")
        result, summary = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(summary["stage"], "build-api")
        self.assertFalse(self.api_pid.exists())
        self.assertFalse(self.browser_pid.exists())

    def test_untracked_source_refuses_to_claim_head_or_run_build(self):
        (self.repo/'vps-billing/backend/untracked.go').write_text('package main\n')
        result,summary=self.run_helper()
        self.assertEqual(result.returncode,1)
        self.assertEqual(summary['stage'],'source-before')
        self.assertIn('untracked',summary['reason'])
        self.assertFalse(self.api_pid.exists());self.assertFalse(self.browser_pid.exists())

    def test_assertion_failure_is_bounded_and_has_stage(self):
        self.mode.write_text("assertion-fail")
        result, summary = self.run_helper()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(summary["stage"], "browser")
        self.assertIn("synthetic assertion", summary["reason"])
        self.assertLessEqual(len(summary["reason"]), 1600)

    def test_signal_cleans_owned_sessions_including_detached_child(self):
        self.mode.write_text("interrupt")
        process = subprocess.Popen(self.command(), env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            wait_for(self.detached_pid, process)
            process.send_signal(signal.SIGTERM)
            output, error = process.communicate(timeout=15)
        finally:
            if process.poll() is None:
                process.kill();process.wait(timeout=5)
        self.assertEqual(process.returncode, 1, output + error)
        summary = json.loads((self.output / "summary.json").read_text())
        self.assertFalse(summary["passed"])
        self.assertTrue(summary["cleanup"])
        self.assertIn("SIGTERM", summary["reason"])
        self.assertEqual(list(self.temporary.iterdir()), [])
        for marker in (self.api_pid, self.preview_pid, self.browser_pid, self.detached_pid):
            self.assertFalse(Path('/proc/' + marker.read_text()).exists())

    def test_input_guards_reject_reused_output_missing_assets_and_unsafe_browser(self):
        self.output.mkdir()
        with self.assertRaises(browser_demo.Failure):browser_demo.validate_inputs(self.repo,self.chrome,self.output)
        self.output.rmdir()
        self.chrome.chmod(0o777)
        with self.assertRaises(browser_demo.Failure):browser_demo.validate_inputs(self.repo,self.chrome,self.output)
        self.chrome.chmod(0o700)
        index=self.repo/'vps-billing/frontend/dist/index.html';index.unlink()
        with self.assertRaises(browser_demo.Failure):browser_demo.validate_inputs(self.repo,self.chrome,self.output)

    def test_sandbox_source_guard_and_output_containment(self):
        test=self.repo/'vps-billing/frontend/tests/e2e.mjs'
        test.write_text('chromiumSandbox: false; await shot("fixture");')
        with self.assertRaises(browser_demo.Failure):browser_demo.validate_inputs(self.repo,self.chrome,self.output)
        test.write_text('chromiumSandbox: true; await shot("fixture");')
        with self.assertRaises(browser_demo.Failure):browser_demo.validate_inputs(self.repo,self.chrome,self.repo/'evidence')

    def test_exact_screenshots_reject_links_extra_files_and_missing_files(self):
        source=self.root/'screens';source.mkdir();target=self.root/'retained'
        with self.assertRaises(browser_demo.Failure):browser_demo.retain_screenshots(source,target,{'fixture.png'})
        (source/'fixture.png').symlink_to(self.chrome)
        with self.assertRaises((browser_demo.Failure,OSError)):browser_demo.retain_screenshots(source,target,{'fixture.png'})
        (source/'fixture.png').unlink();(source/'fixture.png').write_bytes(PNG);(source/'private.log').write_text('private')
        with self.assertRaises(browser_demo.Failure):browser_demo.retain_screenshots(source,target,{'fixture.png'})

    def test_listener_guard_rejects_response_from_unowned_port(self):
        listeners,ports=browser_demo.reserve_ports()
        try:
            self.assertNotEqual(*ports)
            fake=mock.Mock(pid=os.getpid());fake.poll.return_value=None
            self.assertFalse(browser_demo.listener_owned(fake,ports[0]))
        finally:
            for listener in listeners:listener.close()

    def test_cleanup_uses_identity_handles_never_recycled_numeric_pids(self):
        supervisor=browser_demo.Processes.__new__(browser_demo.Processes)
        supervisor.owned={1234:('old-birth',91)}
        supervisor.sample=mock.Mock()
        with mock.patch.object(signal,'pidfd_send_signal',side_effect=ProcessLookupError) as send, mock.patch.object(os,'kill') as kill, mock.patch.object(os,'killpg') as killpg:
            self.assertTrue(supervisor.signal_owned(signal.SIGTERM))
            send.assert_called_once_with(91,signal.SIGTERM)
            kill.assert_not_called();killpg.assert_not_called()

    def test_timeout_and_ignored_term_are_forcibly_cleaned(self):
        supervisor=browser_demo.Processes()
        marker=self.root/'ignoring-term.pid'
        child=supervisor.start([sys.executable,'-c',
            'import os,signal,time;from pathlib import Path;signal.signal(signal.SIGTERM,signal.SIG_IGN);Path('+repr(str(marker))+').write_text(str(os.getpid()));time.sleep(60)'],
            self.root,dict(os.environ),self.root/'child-private.log')
        try:
            wait_for(marker,child)
            with self.assertRaises(browser_demo.Failure):supervisor.wait(child,0.05)
        finally:
            self.assertTrue(supervisor.cleanup(timeout=0.1))
        self.assertEqual(child.returncode,-signal.SIGKILL)
        self.assertFalse(Path('/proc/'+str(child.pid)).exists())

    def test_cleanup_failure_is_explicit_and_fails_an_otherwise_successful_run(self):
        program = textwrap.dedent('''\
            import importlib.util,sys
            from pathlib import Path
            spec=importlib.util.spec_from_file_location('fixture_browser',sys.argv[1])
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            original=module.Processes.cleanup
            def incomplete(self,*args,**kwargs):
                original(self,*args,**kwargs)
                return False
            module.Processes.cleanup=incomplete
            raise SystemExit(module.run(Path(sys.argv[2]),Path(sys.argv[3]),Path(sys.argv[4])))
        ''')
        result=subprocess.run([sys.executable,'-I','-c',program,str(SCRIPT),str(self.repo),str(self.chrome),str(self.output)],env=self.env,capture_output=True,text=True,timeout=25)
        summary=json.loads((self.output/'summary.json').read_text())
        self.assertEqual(result.returncode,1,result.stdout+result.stderr)
        self.assertFalse(summary['passed']);self.assertFalse(summary['cleanup'])
        self.assertIn('cleanup failed',summary['reason'])
        self.assertEqual(list(self.temporary.iterdir()),[])

    def test_descendant_discovery_rechecks_direct_parent_after_opening_handle(self):
        supervisor=browser_demo.Processes.__new__(browser_demo.Processes);supervisor.owned={}
        snapshots=[{9876:(os.getpid(),'original','S')},{9876:(1111,'original','S')}]
        with mock.patch.object(browser_demo,'process_snapshot',side_effect=snapshots),mock.patch.object(os,'pidfd_open',return_value=71),mock.patch.object(os,'close') as close:
            supervisor.sample()
            self.assertEqual(supervisor.owned,{})
            close.assert_called_once_with(71)

    def test_live_checks_kernel_handle_even_when_proc_snapshot_omits_process(self):
        supervisor=browser_demo.Processes.__new__(browser_demo.Processes);supervisor.owned={123:('birth',17)};supervisor.sample=mock.Mock()
        with mock.patch.object(browser_demo.select,'poll') as poll:
            poll.return_value.poll.return_value=[]
            self.assertTrue(supervisor.live())
            poll.return_value.poll.return_value=[(17,browser_demo.select.POLLIN)]
            self.assertFalse(supervisor.live())


if __name__ == '__main__':
    unittest.main()
