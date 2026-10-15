#!/usr/bin/env python3
"""校验并打包可直接添加为本地市场的插件源码。作者：Jason.chen。"""
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
plugin = root / 'plugins/zcode-project-alias'
manifest = json.loads((plugin / '.zcode-plugin/plugin.json').read_text())
market = json.loads((root / 'marketplace.json').read_text())
assert len(market['plugins']) == 1
entry = market['plugins'][0]
assert entry['name'] == manifest['name'] == 'zcode-project-alias'
assert entry['version'] == manifest['version']
assert (root / entry['source']).resolve() == plugin
assert list((plugin / 'commands').glob('*.md'))
subprocess.run(['node', '--check', str(plugin / 'runtime/alias.js')], check=True)
output = root / 'dist'
output.mkdir(exist_ok=True)
archive = output / f'zcode-project-alias-{manifest["version"]}.zip'
paths = [root / 'marketplace.json', root / 'README.md', root / 'INSTALL-ZCODE-AI.md']
paths += sorted(path for path in plugin.rglob('*') if path.is_file() and '__pycache__' not in path.parts)
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as stream:
    for path in paths:
        stream.write(path, Path('zcode-project-alias') / path.relative_to(root))
with zipfile.ZipFile(archive) as stream:
    assert stream.testzip() is None
    assert not any('node_modules' in name or '__pycache__' in name for name in stream.namelist())
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.zip.sha256').write_text(f'{digest}  {archive.name}\n')
print(json.dumps({'archive': str(archive), 'files': len(paths), 'sha256': digest}, ensure_ascii=False, indent=2))
