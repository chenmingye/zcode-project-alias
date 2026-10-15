"""在临时 Token 插件目录验证安装器，绝不修改本机正在运行的实例。"""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('installer', Path(__file__).parents[1] / 'plugins/zcode-project-alias/scripts/install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'inject-main.cjs').write_text('hotReloadIfChanged overlay.js executeJavaScript 2000')
        self.original = b'// Token original\r\n(() => { window.tokenKept = true; })();\r\n'
        self.overlay = self.root / 'overlay.js'
        self.overlay.write_bytes(self.original)

    def test_idempotent_install_uninstall_and_original_preserved(self):
        result = installer.update(self.root, 'install')
        self.assertEqual(result['state'], 'installed')
        self.assertEqual(Path(result['backup']).read_bytes(), self.original)
        installed = self.overlay.read_bytes()
        installer.update(self.root, 'install')
        self.assertEqual(self.overlay.read_bytes(), installed)
        result = installer.update(self.root, 'uninstall')
        base, payload = installer.split_overlay(self.overlay.read_bytes())
        self.assertEqual(base, self.original)
        self.assertEqual(payload, installer.CLEANUP)
        self.assertEqual(result['state'], 'uninstalled')
        installer.update(self.root, 'install')
        self.assertEqual(self.overlay.read_bytes(), installed)

    def test_corrupt_markers_and_other_plugin_tail_refuse_writes(self):
        for content in [self.original + installer.BEGIN,
                        self.original + installer.BEGIN + b'x' + installer.END + b'other plugin']:
            self.overlay.write_bytes(content)
            with self.assertRaises(ValueError): installer.update(self.root, 'install')
            self.assertEqual(self.overlay.read_bytes(), content)

    def test_invalid_javascript_and_disabled_reload_preserve_file(self):
        self.overlay.write_bytes(b'(() => { syntax error')
        with self.assertRaises(ValueError): installer.update(self.root, 'install')
        self.assertEqual(self.overlay.read_bytes(), b'(() => { syntax error')
        self.overlay.write_bytes(self.original)
        (self.root / 'config.json').write_text('{"hot_reload":false}')
        with self.assertRaises(ValueError): installer.update(self.root, 'install')
        self.assertEqual(self.overlay.read_bytes(), self.original)

    def test_uninstalled_noop_and_unknown_loader(self):
        installer.update(self.root, 'uninstall')
        self.assertEqual(self.overlay.read_bytes(), self.original)
        (self.root / 'inject-main.cjs').write_text('unknown')
        with self.assertRaises(ValueError): installer.update(self.root, 'install')
        self.assertEqual(self.overlay.read_bytes(), self.original)


if __name__ == '__main__': unittest.main()
