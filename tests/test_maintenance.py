import importlib.util
import json
from pathlib import Path
import plistlib
import tempfile
import unittest

source = Path(__file__).resolve().parents[1] / 'plugins/zcode-project-alias/scripts/maintenance.py'
spec = importlib.util.spec_from_file_location('maintenance', source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MaintenanceTest(unittest.TestCase):
    def test_retire_archives_only_own_launcher_and_preserves_nicknames(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            runtime = base / 'zcode-project-alias'
            runtime.mkdir()
            (runtime / 'enabled.json').write_text('{"enabled":true,"runtimeVersion":"0.6.0"}')
            (runtime / 'panel').mkdir()
            data = runtime / 'panel/projects.json'
            data.write_text('saved nickname data')
            launcher = base / 'Applications/昵称.app'
            (launcher / 'Contents').mkdir(parents=True)
            (launcher / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'io.github.chenmingye.zcode-project-alias'}))
            result = module.retire_legacy(base, launcher)
            self.assertFalse(json.loads((runtime / 'enabled.json').read_text())['enabled'])
            self.assertFalse(launcher.exists())
            self.assertTrue(Path(result['launcher_archived']).exists())
            self.assertEqual(data.read_text(), 'saved nickname data')
            self.assertIsNone(module.retire_legacy(base, launcher)['launcher_archived'])

    def test_unrelated_launcher_is_never_moved(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            launcher = base / 'Other.app'
            (launcher / 'Contents').mkdir(parents=True)
            (launcher / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'other.application'}))
            with self.assertRaises(ValueError):
                module.retire_legacy(base, launcher)
            self.assertTrue(launcher.exists())


if __name__ == '__main__':
    unittest.main()
