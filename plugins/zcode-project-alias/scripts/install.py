#!/usr/bin/env python3
"""安装独立伴随启动器，保留 ZCode 厂商签名。作者：Jason.chen。"""
import argparse
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.6.0'
REQUIREMENT = '=anchor apple generic and identifier "dev.zcode.app" and certificate leaf[subject.OU] = "8A5X4JJ39T"'
RESTART_DIALOG = '''on run argv
display dialog "项目昵称需要通过独立启动器重新打开 ZCode，原应用与厂商签名保持不变。请先保存工作。" with title "ZCode 项目昵称" buttons {"稍后", "重新打开"} default button "稍后" with icon POSIX file (item 1 of argv) giving up after 60
end run'''


def atomic_write(path, data, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.alias-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def app_info(app):
    metadata = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    if metadata.get('CFBundleIdentifier') != 'dev.zcode.app':
        raise ValueError('目标不是 ZCode；未修改应用')
    return metadata, app / 'Contents/MacOS' / metadata['CFBundleExecutable']


def verify_app(app):
    result = subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', '-R', REQUIREMENT, str(app)], capture_output=True, text=True)
    return result.returncode == 0, result.stderr.strip()


def app_running(executable):
    result = subprocess.run(['ps', '-axo', 'pid=,comm='], check=True, capture_output=True, text=True)
    names = {str(executable), executable.name}
    rows = [line.strip().split(None, 1) for line in result.stdout.splitlines()]
    return [int(row[0]) for row in rows if len(row) == 2 and row[1] in names]


def responsible_pid(pid):
    """只读核对系统责任归属，不改变进程或校验策略。"""
    try:
        function = ctypes.CDLL('/usr/lib/libSystem.B.dylib').responsibility_get_pid_responsible_for_pid
        function.argtypes = [ctypes.c_int]
        function.restype = ctypes.c_int
        return function(pid)
    except (OSError, AttributeError):
        return None


def control(data_dir, action):
    # 路径归当前用户，服务器只提供固定的状态/刷新操作。
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(10)
        client.connect(str(data_dir / 'control.sock'))
        client.sendall(json.dumps({'action': action}).encode() + b'\n')
        buffer = b''
        while b'\n' not in buffer:
            chunk = client.recv(65536)
            if not chunk:
                raise ValueError('伴随加载器未返回状态')
            buffer += chunk
            if len(buffer) > 1024 * 1024:
                raise ValueError('状态响应过大')
        return json.loads(buffer.split(b'\n')[0])


def inspect(app, data_dir):
    metadata, executable = app_info(app)
    verified, signature_error = verify_app(app)
    pids = app_running(executable)
    try:
        live = control(data_dir, 'status')
        if live.get('appPid') not in pids or live.get('appPath') != str(app):
            live = None
    except (OSError, ValueError):
        live = None
    try:
        enabled = json.loads((data_dir / 'enabled.json').read_text()).get('enabled') is True
    except (OSError, ValueError):
        enabled = False
    source = data_dir / 'alias.js'
    ui_hash = hashlib.sha256(source.read_bytes()).hexdigest() if source.exists() else None
    service_changed = bool(live and any(live.get(key) != hashlib.sha256((data_dir / name).read_bytes()).hexdigest()
                                       for key, name in [('companionHash', 'companion.cjs'), ('serviceHash', 'name-suggestions.cjs'), ('launcherHash', 'launch-signed.py')]
                                       if (data_dir / name).exists()))
    responsibility_pid = responsible_pid(live['appPid']) if live else None
    responsibility_verified = bool(live and responsibility_pid == live['appPid'])
    live_verified = bool(verified and responsibility_verified and enabled and live and live.get('connected') is True and not live.get('error') and any(
        w.get('sourceHash') == ui_hash and not w.get('error') and w.get('runtime', {}).get('version') == VERSION
        for w in live.get('windows', []) if isinstance(w.get('runtime'), dict)))
    return {'version': VERSION, 'app': str(app), 'app_version': metadata.get('CFBundleShortVersionString'),
            'data_dir': str(data_dir), 'signature_verified': verified, 'signature_error': signature_error,
            'responsibility_pid': responsibility_pid, 'responsibility_verified': responsibility_verified,
            'transport': 'anonymous-pipe', 'running_pids': pids, 'live': live, 'enabled': enabled,
            'live_verified': live_verified and not service_changed, 'restart_required': bool(enabled and pids and (not live or service_changed or not responsibility_verified)),
            'state': 'active' if live_verified else 'disabled' if not enabled else 'prepared'}


def prepare(data_dir, app, launcher):
    node = shutil.which('node')
    if not node:
        raise ValueError('需要 Node.js 运行伴随加载器；未修改应用')
    contents = {name: (ROOT / 'runtime' / name).read_bytes() for name in ['alias.js', 'companion.cjs', 'name-suggestions.cjs']}
    for name, content in contents.items():
        subprocess.run([node, '--check', '-'], input=content, capture_output=True, check=True)
        atomic_write(data_dir / name, content)
    launch_source = (ROOT / 'runtime/launch-signed.py').read_bytes()
    compile(launch_source, 'launch-signed.py', 'exec')
    atomic_write(data_dir / 'launch-signed.py', launch_source)
    atomic_write(data_dir / 'enabled.json', json.dumps({'enabled': True, 'runtimeVersion': VERSION}).encode())
    # 仅新建自己的用户级启动器；ZCode.app 的任何资源均不写入。
    entry = launcher / 'Contents/MacOS/launch'
    command = [sys.executable, str(data_dir / 'install.py'), 'start', '--app', str(app), '--data-dir', str(data_dir), '--launcher', str(launcher), '--gui']
    atomic_write(data_dir / 'install.py', Path(__file__).read_bytes())
    atomic_write(entry, ('#!/bin/sh\nexec ' + shlex.join(command) + '\n').encode(), 0o700)
    info = {'CFBundleIdentifier': 'io.github.chenmingye.zcode-project-alias', 'CFBundleName': 'ZCode 项目昵称',
            'CFBundleDisplayName': 'ZCode 项目昵称', 'CFBundleExecutable': 'launch', 'CFBundlePackageType': 'APPL',
            'CFBundleShortVersionString': VERSION, 'CFBundleIconFile': 'icon.icns', 'LSUIElement': True}
    atomic_write(launcher / 'Contents/Info.plist', plistlib.dumps(info))
    icon = app / 'Contents/Resources/icon.icns'
    if icon.exists():
        atomic_write(launcher / 'Contents/Resources/icon.icns', icon.read_bytes())
    atomic_write(data_dir / 'launch-config.json', json.dumps({'node': node, 'python': sys.executable, 'app': str(app), 'launcher': str(launcher)}).encode())


def ask_restart(app):
    result = subprocess.run(['osascript', '-e', RESTART_DIALOG, str(app / 'Contents/Resources/icon.icns')], capture_output=True, text=True, timeout=70)
    return result.returncode == 0 and 'button returned:重新打开' in result.stdout and 'gave up:true' not in result.stdout


def quit_app(app, executable):
    metadata, _ = app_info(app)
    subprocess.run(['osascript', '-e', f'tell application id "{metadata["CFBundleIdentifier"]}" to quit'], capture_output=True, check=True, timeout=30)
    for _ in range(60):
        if not app_running(executable):
            return
        time.sleep(1)
    raise ValueError('正常退出未完成，未强制结束进程；稍后从独立启动器打开即可')


def start(app, data_dir, no_prompt=False, restart=False):
    state = inspect(app, data_dir)
    if not state['signature_verified']:
        raise ValueError('厂商完整签名校验失败，请先恢复官方 ZCode。不会重签名或绕过校验。' + state['signature_error'])
    if state['live'] and not state['restart_required']:
        control(data_dir, 'refresh')
        subprocess.run(['open', str(app)], check=True)
        return inspect(app, data_dir)
    _, executable = app_info(app)
    if state['running_pids']:
        if not restart and (no_prompt or not ask_restart(app)):
            return state
        quit_app(app, executable)
    config = json.loads((data_dir / 'launch-config.json').read_text())
    log = data_dir / 'companion.log'
    with log.open('ab') as stream:
        os.chmod(log, 0o600)
        child = subprocess.Popen([config['node'], str(data_dir / 'companion.cjs'), '--app', str(app), '--data-dir', str(data_dir)],
                                 stdin=subprocess.DEVNULL, stdout=stream, stderr=stream, start_new_session=True, close_fds=True)
    for _ in range(40):
        if child.poll() is not None:
            raise ValueError(f'伴随进程退出（{child.returncode}），请检查 {log}')
        state = inspect(app, data_dir)
        if state['live_verified']:
            return state
        time.sleep(0.5)
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['doctor', 'install', 'start', 'uninstall'])
    parser.add_argument('--app', type=Path, default=Path('/Applications/ZCode.app'))
    parser.add_argument('--data-dir', type=Path, default=Path.home() / '.zcode/zcode-project-alias')
    parser.add_argument('--launcher', type=Path, default=Path.home() / 'Applications/ZCode 项目昵称.app')
    parser.add_argument('--no-prompt', action='store_true')
    parser.add_argument('--gui', action='store_true', help='启动器模式：错误以原生消息框显示')
    parser.add_argument('--restart', action='store_true', help='已授权正常退出并通过伴随启动器重新打开；不强杀进程')
    args = parser.parse_args()
    app, data_dir, launcher = args.app.resolve(), args.data_dir.resolve(), args.launcher.resolve()
    if args.action == 'doctor':
        result = inspect(app, data_dir)
    else:
        data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(data_dir, 0o700)
        with (data_dir / 'install.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if args.action == 'uninstall':
                atomic_write(data_dir / 'enabled.json', json.dumps({'enabled': False, 'runtimeVersion': VERSION}).encode())
                try:
                    control(data_dir, 'refresh')
                except (OSError, ValueError):
                    pass
                # 名称与置顶仍在宿主存储中；不关闭正在使用的应用。
                if launcher.exists():
                    metadata = plistlib.loads((launcher / 'Contents/Info.plist').read_bytes())
                    if metadata.get('CFBundleIdentifier') == 'io.github.chenmingye.zcode-project-alias':
                        shutil.rmtree(launcher)
                result = inspect(app, data_dir)
            else:
                verified, error = verify_app(app)
                if not verified:
                    raise ValueError('需要官方完整签名的 ZCode；已停止，不修改或重签名应用。' + error)
                if args.action == 'install':
                    prepare(data_dir, app, launcher)
                result = start(app, data_dir, args.no_prompt, args.restart)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 2 if result['enabled'] and not result['live_verified'] else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(json.dumps({'state': 'error', 'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        if '--gui' in sys.argv:
            try:
                subprocess.run(['osascript', '-e', 'on run argv\ndisplay dialog (item 1 of argv) with title "ZCode 项目昵称启动失败" buttons {"好"} default button "好"\nend run', str(error)], capture_output=True, timeout=90)
            except (OSError, subprocess.SubprocessError):
                pass
        sys.exit(1)
