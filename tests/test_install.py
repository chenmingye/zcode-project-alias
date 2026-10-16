"""独立安装器回归：只操作临时应用，无其他插件，无真实应用签名操作。"""
import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import struct
import subprocess
import tempfile
import time
import unittest
import shutil
import sys
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installer', Path(__file__).parents[1] / 'plugins/zcode-project-alias/scripts/install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def make_archive(path, files):
    tree = {'files': {}}
    data = b''
    for name, content in files.items():
        node = tree
        parts = name.split('/')
        for part in parts[:-1]:
            node = node['files'].setdefault(part, {'files': {}})
        node['files'][parts[-1]] = {'size': len(content), 'offset': str(len(data)), 'integrity': {
            'algorithm': 'SHA256', 'hash': hashlib.sha256(content).hexdigest(),
            'blockSize': 4194304, 'blocks': [hashlib.sha256(content).hexdigest()]}}
        data += content
    raw = json.dumps(tree, separators=(',', ':')).encode()
    pad = (-len(raw)) % 4
    path.write_bytes(struct.pack('<4I', 4, len(raw) + pad + 8, len(raw) + pad + 4, len(raw)) + raw + b'\0' * pad + data)
    return hashlib.sha256(raw).hexdigest()


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / 'ZCode.app'
        self.data = self.root / 'data'
        self.archive = self.app / 'Contents/Resources/app.asar'
        self.info = self.app / 'Contents/Info.plist'
        self.exe = self.app / 'Contents/MacOS/ZCode'
        self.archive.parent.mkdir(parents=True)
        self.exe.parent.mkdir(parents=True)
        self.exe.write_bytes(b'fake-executable')
        self.signature = self.app / 'Contents/_CodeSignature/CodeResources'
        self.signature.parent.mkdir()
        self.signature.write_bytes(b'original-signature')
        self.original = b'import fs from "node:fs";\n// unrelated client integration\nimport("file:///unrelated-loader.cjs");\n'
        header_hash = make_archive(self.archive, {
            'package.json': b'{"main":"out/main/index.js","type":"module"}',
            'out/main/index.js': self.original,
            'unchanged.txt': '其他资源保持原样'.encode(),
        })
        self.info.write_bytes(plistlib.dumps({'CFBundleIdentifier': 'dev.zcode.app', 'CFBundleExecutable': 'ZCode',
            'CFBundleShortVersionString': '3.15.3', 'ElectronAsarIntegrity': {
                'Resources/app.asar': {'algorithm': 'SHA256', 'hash': header_hash}}}))
        self.running = patch.object(installer, 'app_running', return_value=[])
        self.running.start()
        self.addCleanup(self.running.stop)
        self.signing = patch.object(installer, 'resign')
        self.sign = self.signing.start()
        self.addCleanup(self.signing.stop)

    def test_install_without_any_other_plugin_and_preserve_existing_code(self):
        result = installer.run('install', self.app, self.data)
        self.assertEqual(result['state'], 'installed')
        asar = installer.Asar(self.archive)
        before, hook, after = installer.split_hook(asar.entry)
        self.assertEqual(before + after, self.original)
        self.assertIn((self.data / 'loader.cjs').as_uri().encode(), hook)
        self.assertEqual(asar.read('unchanged.txt'), '其他资源保持原样'.encode())
        self.assertEqual(installer.inspect(self.app, self.data)[1]['hook_matches'], True)
        self.assertTrue((Path(result['backup']) / 'app.asar').exists())
        self.assertTrue((self.data / 'alias.js').exists())
        self.sign.assert_called_once_with(self.app)
        installed_bytes = self.archive.read_bytes()
        installer.run('install', self.app, self.data)
        self.assertEqual(installed_bytes, self.archive.read_bytes())
        self.assertEqual(self.sign.call_count, 1)

    def test_running_first_install_only_prepares_own_files(self):
        old = self.archive.read_bytes(), self.info.read_bytes(), self.exe.read_bytes()
        with patch.object(installer, 'app_running', return_value=[123]), \
                patch.object(installer, 'ask_restart', return_value=False):
            result = installer.run('install', self.app, self.data)
        self.assertEqual(result['state'], 'prepared')
        self.assertTrue(result['restart_required'])
        self.assertFalse(result['hook_installed'])
        self.assertEqual(old, (self.archive.read_bytes(), self.info.read_bytes(), self.exe.read_bytes()))
        self.sign.assert_not_called()
        self.assertTrue((self.data / 'loader.cjs').exists())

    def test_confirm_restart_quits_installs_and_relaunches(self):
        running = [123]
        launched = []
        with patch.object(installer, 'app_running', side_effect=lambda executable: list(running)), \
                patch.object(installer, 'ask_restart', return_value=True), \
                patch.object(installer, 'quit_app', side_effect=lambda app, executable: running.clear() or True), \
                patch.object(installer, 'launch_app', side_effect=lambda app: launched.append(str(app))):
            result = installer.run('install', self.app, self.data)
        self.assertEqual(result['state'], 'installed')
        self.assertTrue(result['hook_matches'])
        self.assertTrue(result['restart_completed'])
        self.assertTrue((Path(result['backup']) / 'app.asar').exists())
        self.assertEqual(launched, [str(self.app)])
        self.sign.assert_called_once_with(self.app)

    def test_declined_restart_only_prepares(self):
        old = self.archive.read_bytes()
        with patch.object(installer, 'app_running', return_value=[123]), \
                patch.object(installer, 'ask_restart', return_value=False):
            result = installer.run('install', self.app, self.data)
        self.assertEqual(result['state'], 'prepared')
        self.assertTrue(result['restart_required'])
        self.assertEqual(self.archive.read_bytes(), old)
        self.sign.assert_not_called()

    def test_no_prompt_flag_skips_dialog_and_prepares(self):
        with patch.object(installer, 'app_running', return_value=[123]), \
                patch.object(installer, 'ask_restart') as ask:
            result = installer.run('install', self.app, self.data, no_prompt=True)
        self.assertEqual(result['state'], 'prepared')
        self.assertFalse(result['hook_installed'])
        ask.assert_not_called()

    def test_quit_timeout_falls_back_to_prepared(self):
        old = self.archive.read_bytes()
        with patch.object(installer, 'app_running', return_value=[123]), \
                patch.object(installer, 'ask_restart', return_value=True), \
                patch.object(installer, 'quit_app', return_value=False):
            result = installer.run('install', self.app, self.data)
        self.assertEqual(result['state'], 'prepared')
        self.assertEqual(self.archive.read_bytes(), old)

    def test_loader_update_prompts_restart_without_rewriting_archive(self):
        installer.run('install', self.app, self.data)
        hooked = self.archive.read_bytes()
        status = self.data / 'status/123.json'
        status.parent.mkdir(parents=True, exist_ok=True)
        status.write_text(json.dumps({'pid': 123, 'updatedAt': time.time() * 1000,
                                      'loaderHash': 'stale-loader-hash', 'serviceHash': 'stale-service-hash'}))
        launched = []
        with patch.object(installer, 'app_running', return_value=[123]), \
                patch.object(installer, 'ask_restart', return_value=True), \
                patch.object(installer, 'quit_app', return_value=True), \
                patch.object(installer, 'launch_app', side_effect=lambda app: launched.append(str(app))):
            result = installer.run('install', self.app, self.data)
        self.assertEqual(result['state'], 'installed')
        self.assertTrue(result['restart_completed'])
        self.assertEqual(self.archive.read_bytes(), hooked)
        self.assertEqual(launched, [str(self.app)])
        self.assertEqual(self.sign.call_count, 1)

    def test_up_to_date_running_install_does_not_prompt(self):
        installer.run('install', self.app, self.data)
        hooked = self.archive.read_bytes()
        with patch.object(installer, 'app_running', return_value=[123]), \
                patch.object(installer, 'ask_restart') as ask:
            result = installer.run('install', self.app, self.data)
        self.assertEqual(result['state'], 'installed')
        self.assertNotIn('restart_completed', result)
        self.assertEqual(self.archive.read_bytes(), hooked)
        ask.assert_not_called()

    def test_restart_dialog_applescript_compiles_with_and_without_icon(self):
        """用 osacompile 编译校验弹窗脚本但不弹出；跨行写法会被 osascript 拒绝，必须单行。"""
        icon = self.app / 'Contents/Resources/icon.icns'
        icon.parent.mkdir(parents=True, exist_ok=True)
        icon.write_bytes(b'icns-fixture')
        for app in (None, self.app):
            script = installer.restart_dialog(app)
            self.assertNotIn('\n', script)
            compiled = subprocess.run(['osacompile', '-o', str(self.root / 'dialog.scpt'), '-e', script],
                                      capture_output=True)
            self.assertEqual(compiled.returncode, 0, compiled.stderr.decode()[:300])
        self.assertIn('icon.icns', installer.restart_dialog(self.app))
        icon.unlink()
        self.assertNotIn('icon.icns', installer.restart_dialog(self.app))

    def test_ask_restart_ignores_timeout_and_unavailable(self):
        timed_out = subprocess.CompletedProcess([], 0, stdout='button returned:立即重启, gave up:true\n', stderr='')
        with patch.object(installer.subprocess, 'run', return_value=timed_out):
            self.assertFalse(installer.ask_restart(self.app))
        with patch.object(installer.subprocess, 'run', side_effect=FileNotFoundError('no osascript')):
            self.assertFalse(installer.ask_restart(self.app))
        confirmed = subprocess.CompletedProcess([], 0, stdout='button returned:立即重启\n', stderr='')
        with patch.object(installer.subprocess, 'run', return_value=confirmed):
            self.assertTrue(installer.ask_restart(self.app))

    def test_loader_with_in_app_prompt_does_not_use_installer_dialog(self):
        """运行中的加载器已支持应用内确认（0.5.1+）时，安装器不再弹系统框。"""
        self.assertTrue(installer.supports_in_app_prompt('0.5.1'))
        self.assertTrue(installer.supports_in_app_prompt('0.6.0'))
        self.assertFalse(installer.supports_in_app_prompt('0.5.0'))
        self.assertFalse(installer.supports_in_app_prompt(None))
        installer.run('install', self.app, self.data)
        hooked = self.archive.read_bytes()
        status = self.data / 'status/123.json'
        status.parent.mkdir(parents=True, exist_ok=True)
        status.write_text(json.dumps({'pid': 123, 'version': '0.5.1', 'updatedAt': time.time() * 1000,
                                      'loaderHash': 'stale-loader-hash', 'serviceHash': 'stale-service-hash'}))
        with patch.object(installer, 'app_running', return_value=[123]), \
                patch.object(installer, 'ask_restart') as ask:
            result = installer.run('install', self.app, self.data)
        self.assertEqual(result['state'], 'installed')
        self.assertTrue(result['loader_restart_required'])
        self.assertEqual(self.archive.read_bytes(), hooked)
        ask.assert_not_called()
        self.assertIn('应用内重启确认', result['note'])

    def test_renamed_electron_process_is_still_treated_as_running(self):
        self.running.stop()
        rows = f'18708 ZCode\n18721 /Applications/ZCode.app/Contents/Frameworks/ZCode Helper\n99 {self.exe}\n'
        with patch.object(installer.subprocess, 'run', return_value=type('Result', (), {'stdout': rows})()):
            self.assertEqual(installer.app_running(self.exe), [18708, 99])

    def test_uninstall_while_running_then_remove_own_hook_when_closed(self):
        installer.run('install', self.app, self.data)
        hooked = self.archive.read_bytes()
        with patch.object(installer, 'app_running', return_value=[123]):
            result = installer.run('uninstall', self.app, self.data)
        self.assertEqual(result['state'], 'disabled')
        self.assertEqual(self.archive.read_bytes(), hooked)
        self.assertFalse(json.loads((self.data / 'enabled.json').read_text())['enabled'])
        installer.run('uninstall', self.app, self.data, remove_hook=True)
        self.assertEqual(installer.Asar(self.archive).entry, self.original)
        self.assertFalse(installer.inspect(self.app, self.data)[1]['hook_installed'])

    def test_signature_failure_rolls_back_archive_plist_binary_and_signature(self):
        old = self.archive.read_bytes(), self.info.read_bytes(), self.exe.read_bytes()
        def broken_sign(_app):
            self.exe.write_bytes(b'partially-re-signed')
            self.signature.write_bytes(b'new-signature')
            raise subprocess.CalledProcessError(1, 'codesign')
        self.sign.side_effect = broken_sign
        with self.assertRaises(subprocess.CalledProcessError):
            installer.run('install', self.app, self.data)
        self.assertEqual(old, (self.archive.read_bytes(), self.info.read_bytes(), self.exe.read_bytes()))
        self.assertEqual(self.signature.read_bytes(), b'original-signature')

    def test_invalid_integrity_and_corrupt_hook_refuse_changes(self):
        metadata = plistlib.loads(self.info.read_bytes())
        metadata['ElectronAsarIntegrity']['Resources/app.asar']['algorithm'] = 'unknown'
        self.info.write_bytes(plistlib.dumps(metadata))
        old = self.archive.read_bytes()
        with self.assertRaises(ValueError): installer.run('install', self.app, self.data)
        self.assertEqual(self.archive.read_bytes(), old)
        for content in [self.original + installer.BEGIN, self.original + installer.END]:
            with self.assertRaises(ValueError): installer.split_hook(content)

    def test_prior_header_mismatch_is_reported_and_final_integrity_is_correct(self):
        metadata = plistlib.loads(self.info.read_bytes())
        metadata['ElectronAsarIntegrity']['Resources/app.asar']['hash'] = 'outdated'
        self.info.write_bytes(plistlib.dumps(metadata))
        self.assertFalse(installer.inspect(self.app, self.data)[1]['asar_integrity_matches'])
        installer.run('install', self.app, self.data)
        self.assertTrue(installer.inspect(self.app, self.data)[1]['asar_integrity_matches'])

    def test_own_hook_changes_preserve_code_before_and_after(self):
        hooked = installer.hook_entry(self.original, self.data) + b'\n// added later\n'
        self.assertEqual(installer.hook_entry(hooked, self.data, remove=True), self.original + b'\n// added later\n')
        new = installer.hook_entry(hooked, self.root / 'new-data')
        self.assertIn(b'// added later', new)
        self.assertEqual(new.count(installer.BEGIN), 1)

    def test_doctor_is_read_only_and_stale_status_is_not_live(self):
        result = installer.run('doctor', self.app, self.data)
        self.assertEqual(result['state'], 'not_installed')
        self.assertFalse(self.data.exists())
        status = self.data / 'status/123.json'
        status.parent.mkdir(parents=True)
        status.write_text('{"pid":123,"updatedAt":0}')
        self.assertEqual(installer.live_status(self.data, [123]), [])

    @unittest.skipUnless(sys.platform == 'darwin' and shutil.which('codesign'), 'macOS 签名验证仅适用于 macOS')
    def test_real_codesign_on_disposable_fixture_app(self):
        # 复制系统可执行文件到临时应用，只验证本地签名和 ASAR 校验，不启动它。
        self.signing.stop()
        shutil.copyfile('/usr/bin/true', self.exe)
        self.exe.chmod(0o755)
        metadata = plistlib.loads(self.info.read_bytes())
        metadata.update(CFBundlePackageType='APPL', CFBundleVersion='1')
        self.info.write_bytes(plistlib.dumps(metadata))
        subprocess.run(['codesign', '--force', '--sign', '-', '--options', 'runtime', str(self.app)], check=True, capture_output=True)
        result = installer.run('install', self.app, self.data)
        self.assertEqual(result['state'], 'installed')
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(self.app)], check=True, capture_output=True)
        self.assertTrue(installer.inspect(self.app, self.data)[1]['hook_matches'])


if __name__ == '__main__': unittest.main()
