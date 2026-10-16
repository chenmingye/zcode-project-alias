"""伴随安装器回归：只写自己的文件，失败关闭，不破坏官方签名。作者：Jason.chen。"""
import importlib.util
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'plugins/zcode-project-alias/scripts/install.py'
spec = importlib.util.spec_from_file_location('alias_install', SOURCE)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app = self.root / 'ZCode.app'
        (self.app / 'Contents/Resources').mkdir(parents=True)
        (self.app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'dev.zcode.app', 'CFBundleExecutable': 'ZCode', 'CFBundleShortVersionString': '3.15.3'}))
        (self.app / 'Contents/Resources/app.asar').write_bytes(b'original-vendor-resource')
        self.data = self.root / 'runtime'
        self.launcher = self.root / 'ZCode 项目昵称.app'

    def tearDown(self):
        self.temp.cleanup()

    def test_prepare_never_changes_app_and_quotes_launcher_paths(self):
        before = {str(p.relative_to(self.app)): p.read_bytes() for p in self.app.rglob('*') if p.is_file()}
        installer.prepare(self.data, self.app, self.launcher)
        after = {str(p.relative_to(self.app)): p.read_bytes() for p in self.app.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        self.assertTrue((self.data / 'companion.cjs').is_file())
        self.assertFalse((self.data / 'loader.cjs').exists())
        entry = (self.launcher / 'Contents/MacOS/launch').read_text()
        self.assertIn("'", entry)
        self.assertIn(' start --app ', entry)
        self.assertTrue(json.loads((self.data / 'enabled.json').read_text())['enabled'])

    def test_invalid_vendor_signature_stops_before_launch(self):
        with patch.object(installer, 'inspect', return_value={'signature_verified': False, 'signature_error': 'bad signature'}), patch.object(installer.subprocess, 'Popen') as spawn:
            with self.assertRaisesRegex(ValueError, '厂商完整签名校验失败'):
                installer.start(self.app, self.data)
            spawn.assert_not_called()

    def test_running_without_pipe_is_prepared_not_live_and_does_not_quit(self):
        state = {'signature_verified': True, 'live': None, 'running_pids': [123], 'state': 'prepared'}
        with patch.object(installer, 'inspect', return_value=state), patch.object(installer, 'quit_app') as quit_app, patch.object(installer.subprocess, 'Popen') as spawn:
            self.assertEqual(installer.start(self.app, self.data, no_prompt=True), state)
            quit_app.assert_not_called()
            spawn.assert_not_called()

    def test_status_from_a_different_app_process_is_not_accepted(self):
        with patch.object(installer, 'verify_app', return_value=(True, '')), patch.object(installer, 'app_running', return_value=[123]), patch.object(installer, 'control', return_value={'appPid': 456, 'appPath': str(self.app)}):
            state = installer.inspect(self.app, self.data)
        self.assertIsNone(state['live'])
        self.assertFalse(state['live_verified'])

    def test_vendor_requirement_is_enforced_not_resigned(self):
        class Result:
            returncode = 1
            stderr = 'invalid resource'
        with patch.object(installer.subprocess, 'run', return_value=Result()) as run:
            self.assertEqual(installer.verify_app(self.app), (False, 'invalid resource'))
        args = run.call_args.args[0]
        self.assertIn('--strict', args)
        self.assertIn(installer.REQUIREMENT, args)
        self.assertNotIn('--sign', args)

    def test_native_restart_dialog_compiles_with_application_icon(self):
        script = self.root / 'restart.applescript'
        script.write_text(installer.RESTART_DIALOG)
        subprocess.run(['/usr/bin/osacompile', '-o', str(self.root / 'restart.scpt'), str(script)], check=True, capture_output=True)

    def test_signed_process_with_external_responsibility_is_not_reported_active(self):
        installer.prepare(self.data, self.app, self.launcher)
        live = {'appPid': 123, 'appPath': str(self.app), 'connected': True,
                'windows': [{'sourceHash': hashlib.sha256((self.data / 'alias.js').read_bytes()).hexdigest(),
                             'runtime': {'version': installer.VERSION}}]}
        for key, name in [('companionHash', 'companion.cjs'), ('serviceHash', 'name-suggestions.cjs'), ('launcherHash', 'launch-signed.py')]:
            live[key] = hashlib.sha256((self.data / name).read_bytes()).hexdigest()
        with patch.object(installer, 'verify_app', return_value=(True, '')), patch.object(installer, 'app_running', return_value=[123]), patch.object(installer, 'control', return_value=live):
            with patch.object(installer, 'responsible_pid', return_value=999):
                state = installer.inspect(self.app, self.data)
                self.assertFalse(state['live_verified'])
                self.assertTrue(state['restart_required'])
            with patch.object(installer, 'responsible_pid', return_value=123):
                state = installer.inspect(self.app, self.data)
                self.assertTrue(state['live_verified'])
                self.assertFalse(state['restart_required'])


if __name__ == '__main__':
    unittest.main()
