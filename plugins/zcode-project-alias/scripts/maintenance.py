#!/usr/bin/env python3
"""只读诊断，或停用旧昵称加载器并归档自己的启动器。作者：Jason.chen。"""
import argparse
import datetime
import json
import os
from pathlib import Path
import plistlib
import socket
import subprocess
import tempfile


def retire_legacy(base, launcher):
    """仅操作自己旧版的文件与固定停用请求；不退出应用，不修改应用包。"""
    runtime = base / 'zcode-project-alias'
    result = {'disabled': False, 'live_removed': False, 'launcher_archived': None}
    config = runtime / 'enabled.json'
    if config.exists():
        original = config.read_bytes()
        metadata = json.loads(original)
        metadata['enabled'] = False
        fd, temporary = tempfile.mkstemp(prefix='.disabled-', dir=runtime)
        try:
            with os.fdopen(fd, 'w') as stream:
                json.dump(metadata, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, config)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        result['disabled'] = True
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(12)
                client.connect(str(runtime / 'control.sock'))
                client.sendall(b'{"action":"refresh"}\n')
                response = b''
                while b'\n' not in response:
                    chunk = client.recv(65536)
                    if not chunk or len(response) > 1024 * 1024:
                        break
                    response += chunk
                live = json.loads(response.split(b'\n')[0])
                result['live_removed'] = live.get('enabled') is False and all(not w.get('runtime') for w in live.get('windows', []))
        except (OSError, ValueError):
            pass
    if launcher.exists():
        info = plistlib.loads((launcher / 'Contents/Info.plist').read_bytes())
        if info.get('CFBundleIdentifier') != 'io.github.chenmingye.zcode-project-alias':
            raise ValueError('此启动器不属于项目昵称，未移动。')
        recovery = base / 'recovery' / ('project-alias-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
        recovery.mkdir(parents=True, mode=0o700)
        archived = recovery / launcher.name
        launcher.rename(archived)
        result['launcher_archived'] = str(archived)
    return result


def doctor(base, launcher, app):
    signature = subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', '-R',
        '=anchor apple generic and identifier "dev.zcode.app" and certificate leaf[subject.OU] = "8A5X4JJ39T"', str(app)], capture_output=True, text=True)
    config = base / 'zcode-project-alias/enabled.json'
    enabled = json.loads(config.read_text()).get('enabled') is True if config.exists() else False
    return {'version': '0.7.0', 'mode': 'official-ui-plugin', 'signature_verified': signature.returncode == 0,
        'legacy_enabled': enabled, 'legacy_launcher_present': launcher.exists(),
        'panel_data': str(base / 'zcode-project-alias/panel/projects.json'),
        'note': '面板运行情况须在 ZCode 内实际打开确认；签名检查不能代替 Computer Use 调用。'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['doctor', 'retire-legacy'])
    parser.add_argument('--base', type=Path, default=Path(os.environ.get('ZCODE_DATA_BASE_DIR', Path.home() / '.zcode')))
    parser.add_argument('--launcher', type=Path, default=Path.home() / 'Applications/ZCode 项目昵称.app')
    parser.add_argument('--app', type=Path, default=Path('/Applications/ZCode.app'))
    args = parser.parse_args()
    try:
        result = retire_legacy(args.base, args.launcher) if args.action == 'retire-legacy' else doctor(args.base, args.launcher, args.app)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (OSError, ValueError) as error:
        parser.exit(1, f'操作未完成：{error}\n')
