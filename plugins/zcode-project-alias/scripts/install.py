#!/usr/bin/env python3
"""项目昵称独立安装器：自己的启动入口、运行目录和热更新。作者：Jason.chen。"""
import argparse
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BEGIN = b'\n/* BEGIN ZCODE PROJECT ALIAS BOOT v2 */\n'
END = b'\n/* END ZCODE PROJECT ALIAS BOOT v2 */\n'
VERSION = '0.5.0'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def atomic_write(path, data, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.project-alias-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temp, mode)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def syntax_check(source):
    node = shutil.which('node')
    if not node:
        raise ValueError('需要 Node.js 才能校验独立加载器；未修改应用')
    result = subprocess.run([node, '-e', 'new Function(require("fs").readFileSync(0,"utf8"))'],
                            input=source, capture_output=True)
    if result.returncode:
        raise ValueError(f'脚本语法校验失败：{result.stderr.decode()[:400]}')


class Asar:
    """保留全部原数据，仅追加被修改的入口；不解压/覆盖其他插件和资源。"""
    def __init__(self, path):
        self.path = Path(path)
        self.snapshot = self.path.stat()
        with self.path.open('rb') as stream:
            fields = stream.read(16)
            if len(fields) != 16:
                raise ValueError('ASAR 头不完整')
            first, self.header_size, payload_size, size = struct.unpack('<4I', fields)
            if first != 4 or payload_size + 4 != self.header_size or size > self.header_size - 8 or self.header_size > 128 * 1024 * 1024:
                raise ValueError('不支持或损坏的 ASAR 头')
            self.raw_header = stream.read(size)
            self.tree = json.loads(self.raw_header)
        self.base = 8 + self.header_size
        self.data_size = self.snapshot.st_size - self.base
        if self.data_size < 0:
            raise ValueError('ASAR 数据越界')
        self.main = json.loads(self.read('package.json'))['main'].removeprefix('./')
        if '..' in self.main.split('/') or self.main.startswith('/'):
            raise ValueError('ASAR 入口路径非法')
        self.entry = self.read(self.main)

    def node(self, path, tree=None):
        node = tree if tree is not None else self.tree
        for name in path.split('/'):
            node = node['files'][name]
        if node.get('unpacked') or 'link' in node or 'files' in node:
            raise ValueError('入口必须是 ASAR 内的普通文件')
        return node

    def read(self, path):
        node = self.node(path)
        offset, size = int(node['offset']), node['size']
        if offset < 0 or size < 0 or offset + size > self.data_size:
            raise ValueError('ASAR 文件内容越界')
        with self.path.open('rb') as stream:
            stream.seek(self.base + offset)
            data = stream.read(size)
        integrity = node.get('integrity')
        if integrity and (integrity.get('algorithm') != 'SHA256' or integrity.get('hash') != digest(data)):
            raise ValueError(f'ASAR 文件校验失败：{path}')
        return data

    def stage(self, entry, target):
        tree = copy.deepcopy(self.tree)
        node = self.node(self.main, tree)
        block_size = node.get('integrity', {}).get('blockSize', 4194304)
        if not isinstance(block_size, int) or block_size <= 0:
            raise ValueError('无效的 ASAR 校验块大小')
        node.update(size=len(entry), offset=str(self.data_size), integrity={
            'algorithm': 'SHA256', 'hash': digest(entry), 'blockSize': block_size,
            'blocks': [digest(entry[i:i + block_size]) for i in range(0, len(entry), block_size)]})
        header = json.dumps(tree, ensure_ascii=False, separators=(',', ':')).encode()
        padding = b'\0' * ((-len(header)) % 4)
        payload_size = 4 + len(header) + len(padding)
        with target.open('wb') as dest, self.path.open('rb') as source:
            dest.write(struct.pack('<4I', 4, payload_size + 4, payload_size, len(header)))
            dest.write(header + padding)
            source.seek(self.base)
            shutil.copyfileobj(source, dest, 1024 * 1024)
            dest.write(entry)
            dest.flush()
            os.fsync(dest.fileno())
        shutil.copystat(self.path, target)
        check = Asar(target)
        if check.entry != entry:
            raise ValueError('新 ASAR 回读校验失败')
        return digest(header)


def split_hook(entry):
    if BEGIN not in entry and END not in entry:
        return entry, None, b''
    if entry.count(BEGIN) != 1 or entry.count(END) != 1:
        raise ValueError('本插件启动标记损坏，拒绝覆盖')
    before, rest = entry.split(BEGIN)
    payload, after = rest.split(END)
    return before, payload, after


def hook_entry(entry, data_dir, remove=False):
    before, _, after = split_hook(entry)
    if remove:
        return before + after
    # 绝对 URI 经过 JSON 编码；不经过 shell，不把本机路径写进公共源码。
    uri = (data_dir / 'loader.cjs').as_uri()
    payload = (';import(' + json.dumps(uri) + ').catch(e=>console.error("[project-alias] startup:",e));').encode()
    return before + BEGIN + payload + END + after


def app_paths(app):
    info = app / 'Contents/Info.plist'
    metadata = plistlib.loads(info.read_bytes())
    if metadata.get('CFBundleIdentifier') != 'dev.zcode.app':
        raise ValueError('目标不是 ZCode 应用，拒绝修改')
    executable = app / 'Contents/MacOS' / metadata['CFBundleExecutable']
    return info, metadata, executable, app / 'Contents/Resources/app.asar'


def app_running(executable):
    result = subprocess.run(['ps', '-axo', 'pid=,comm='], capture_output=True, text=True, check=True)
    rows = [line.strip().split(None, 1) for line in result.stdout.splitlines()]
    # Electron 可把主进程标题改成 ZCode，macOS 的 comm 此时不再是完整路径。
    # 同名主进程也保守视作在线，宁可只准备文件，不误改正在使用的应用。
    names = {str(executable), executable.name}
    return [int(row[0]) for row in rows if len(row) == 2 and row[1] in names]


def live_status(data_dir, pids):
    results = []
    for pid in pids:
        try:
            row = json.loads((data_dir / 'status' / f'{pid}.json').read_text())
            if row.get('pid') == pid and 0 <= time.time() * 1000 - row['updatedAt'] < 12000:
                results.append(row)
        except (OSError, ValueError, KeyError):
            pass
    return results


def inspect(app, data_dir):
    info, metadata, executable, archive = app_paths(app)
    asar = Asar(archive)
    recorded = metadata.get('ElectronAsarIntegrity', {}).get('Resources/app.asar')
    if recorded and recorded.get('algorithm') != 'SHA256':
        raise ValueError('客户端使用不支持的 ASAR 校验算法')
    integrity_matches = recorded is None or recorded.get('hash') == digest(asar.raw_header)
    before, payload, after = split_hook(asar.entry)
    pids = app_running(executable)
    live = live_status(data_dir, pids)
    expected = hook_entry(before + after, data_dir)
    installed = asar.entry == expected
    try:
        enabled = json.loads((data_dir / 'enabled.json').read_text()).get('enabled') is True
    except (OSError, ValueError, AttributeError):
        enabled = False
    own_loader = data_dir / 'loader.cjs'
    loader_hash = digest(own_loader.read_bytes()) if own_loader.exists() else None
    ui = data_dir / 'alias.js'
    ui_hash = digest(ui.read_bytes()) if ui.exists() else None
    service = data_dir / 'name-suggestions.cjs'
    service_hash = digest(service.read_bytes()) if service.exists() else None
    loader_changed = any(row.get('loaderHash') != loader_hash or row.get('serviceHash') != service_hash for row in live)
    return asar, {
        'version': VERSION, 'app': str(app), 'app_version': metadata.get('CFBundleShortVersionString'),
        'data_dir': str(data_dir), 'asar_integrity_matches': integrity_matches, 'hook_installed': payload is not None,
        'hook_matches': installed, 'running_pids': pids, 'live': live,
        'enabled': enabled, 'loader_restart_required': loader_changed,
        'restart_required': bool(pids) and (not bool(live) or loader_changed),
        'live_verified': enabled and any(r.get('loaderHash') == loader_hash and r.get('serviceHash') == service_hash and any(
            w.get('enabled') and w.get('sourceHash') == ui_hash and w.get('runtime', {}).get('version') == VERSION
            for w in r.get('windows', []) if isinstance(w.get('runtime'), dict)) for r in live),
        'state': ('installed' if enabled else 'disabled') if installed else 'not_installed',
    }


def prepare_runtime(data_dir):
    files = {name: (ROOT / 'runtime' / name).read_bytes() for name in ['alias.js', 'loader.cjs', 'name-suggestions.cjs']}
    for content in files.values():
        syntax_check(content)
    # 运行时代码就绪后最后打开配置开关，避免已有加载器读到一半的文件。
    for name, content in files.items():
        atomic_write(data_dir / name, content)
    atomic_write(data_dir / 'enabled.json', json.dumps({'enabled': True, 'runtimeVersion': VERSION}).encode())


def resign(app):
    # 不关闭 ASAR 校验或硬化运行时。修改应用资源后重新建立本机 ad-hoc 签名，
    # 保留现有 entitlements/runtime flags；不声称保留厂商 Developer ID。
    args = ['codesign', '--force', '--sign', '-', '--preserve-metadata=entitlements,flags,runtime', str(app)]
    subprocess.run(args, check=True, capture_output=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True, capture_output=True)


def ask_restart():
    """应用运行时询问是否立即重启完成安装；无图形界面、超时或选择稍后都返回 False。"""
    dialog = ('display dialog "项目昵称插件已准备完成，需要重启 ZCode 才能生效。"\n'
              'with title "项目昵称插件"\n'
              'buttons {"稍后", "立即重启"}\n'
              'default button "立即重启"\n'
              'giving up after 60')
    try:
        result = subprocess.run(['osascript', '-e', dialog], capture_output=True, text=True, timeout=90)
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0 and 'button returned:立即重启' in result.stdout


def quit_app(app, executable):
    """发送正常退出事件并等待进程结束；超时返回 False。绝不强制终止任何进程。"""
    identifier = plistlib.loads((app / 'Contents/Info.plist').read_bytes()).get('CFBundleIdentifier')
    try:
        subprocess.run(['osascript', '-e', f'tell application id "{identifier}" to quit'],
                       capture_output=True, timeout=30)
    except (OSError, subprocess.SubprocessError):
        return False
    deadline = time.time() + 60
    while time.time() < deadline:
        if not app_running(executable):
            return True
        time.sleep(1)
    return False


def launch_app(app):
    subprocess.run(['open', str(app)], check=False)


def apply_hook(app, data_dir, asar, remove=False):
    info, metadata, executable, archive = app_paths(app)
    entry = hook_entry(asar.entry, data_dir, remove)
    if entry == asar.entry:
        return None
    if app_running(executable):
        raise ValueError('ZCode 仍在运行；不修改应用，请等长任务结束并自行退出后再安装')
    backup = data_dir / 'backups' / str(time.time_ns())
    backup.mkdir(parents=True, mode=0o700)
    originals = {'app.asar': archive, 'Info.plist': info, 'executable': executable}
    for name, path in originals.items():
        shutil.copy2(path, backup / name)
    signature = app / 'Contents/_CodeSignature'
    if signature.exists():
        shutil.copytree(signature, backup / '_CodeSignature')
    atomic_write(backup / 'manifest.json', json.dumps({'app': str(app), 'main': asar.main}).encode())
    fd, temp = tempfile.mkstemp(prefix='.project-alias-', suffix='.asar', dir=archive.parent)
    os.close(fd)
    stage = Path(temp)
    try:
        header_hash = asar.stage(entry, stage)
        if metadata.get('ElectronAsarIntegrity', {}).get('Resources/app.asar'):
            metadata['ElectronAsarIntegrity']['Resources/app.asar']['hash'] = header_hash
        # 入口可能含顶层 await/import，使用 .mjs 的 Node 语法检查。
        with tempfile.TemporaryDirectory(prefix='project-alias-syntax-') as folder:
            source = Path(folder) / 'entry.mjs'
            source.write_bytes(entry)
            subprocess.run(['node', '--check', str(source)], check=True, capture_output=True)
        current = archive.stat()
        if (current.st_ino, current.st_size, current.st_mtime_ns) != (asar.snapshot.st_ino, asar.snapshot.st_size, asar.snapshot.st_mtime_ns):
            raise ValueError('安装期间客户端文件已变化，拒绝覆盖；请稍后重新检查')
        if app_running(executable):
            raise ValueError('ZCode 在安装期间被启动，拒绝修改应用')
        try:
            os.replace(stage, archive)
            atomic_write(info, plistlib.dumps(metadata, fmt=plistlib.FMT_BINARY), info.stat().st_mode & 0o777)
            resign(app)
        except BaseException:
            # 只在本次失败时回滚完整事务；正常卸载绝不拿旧备份覆盖后来更新。
            for name, path in originals.items():
                shutil.copy2(backup / name, path)
            if signature.exists():
                shutil.rmtree(signature)
            if (backup / '_CodeSignature').exists():
                shutil.copytree(backup / '_CodeSignature', signature)
            raise
    finally:
        stage.unlink(missing_ok=True)
    return str(backup)


def run(action, app, data_dir, remove_hook=False, no_prompt=False):
    if action == 'doctor':
        return inspect(app, data_dir)[1]
    data_dir.mkdir(parents=True, mode=0o700, exist_ok=True)
    with (data_dir / 'install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        asar, result = inspect(app, data_dir)
        info, metadata, executable, archive = app_paths(app)
        if action == 'doctor':
            return result
        if action == 'uninstall':
            atomic_write(data_dir / 'enabled.json', b'{"enabled":false}')
            result.update(state='disabled', enabled=False, live_verified=False,
                          note='停用请求已保存；独立加载器将在约 2 秒内撤销自身界面，昵称存储保留。')
            if remove_hook:
                result['backup'] = apply_hook(app, data_dir, asar, remove=True)
                result['hook_installed'] = False
                result['hook_matches'] = False
            return result
        # 已有独立入口时只更新自己的文件；首次安装或加载器更新遇到运行中的客户端时，
        # 先准备文件再询问是否立即重启（--no-prompt 或用户选择稍后时保持只准备）。
        prepare_runtime(data_dir)
        result = inspect(app, data_dir)[1]
        if result['running_pids'] and (not result['hook_matches'] or result['loader_restart_required']):
            if not no_prompt and ask_restart() and quit_app(app, executable):
                try:
                    asar, result = inspect(app, data_dir)
                    if not result['hook_matches']:
                        backup = apply_hook(app, data_dir, asar)
                        result = inspect(app, data_dir)[1]
                        result['backup'] = backup
                finally:
                    # 无论安装是否完成都恢复用户的应用；安装失败时应用资源已按备份回滚。
                    launch_app(app)
                result.update(state='installed', hook_installed=True, hook_matches=True, restart_completed=True,
                              note='已按确认正常重启 ZCode 并完成入口安装；界面随启动加载。')
                return result
            result.update(state='prepared', restart_required=True,
                          note='文件已准备，未修改运行中的 ZCode；退出后重跑 install 即可完成。')
            return result
        if not result['hook_matches']:
            result['backup'] = apply_hook(app, data_dir, asar)
        note = ('使用自己的启动入口；首次需正常启动 ZCode，已有独立加载器时界面热更新。'
                if not result['loader_restart_required'] else
                '界面脚本可热更新；加载器或仓库服务已更新，下次正常启动 ZCode 生效。')
        result.update(state='installed', hook_installed=True, hook_matches=True, note=note)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['doctor', 'install', 'uninstall'])
    parser.add_argument('--app', type=Path, default=Path('/Applications/ZCode.app'))
    parser.add_argument('--data-dir', type=Path, default=Path.home() / '.zcode/zcode-project-alias')
    parser.add_argument('--remove-hook', action='store_true', help='卸载时同时移除应用入口；要求应用已退出')
    parser.add_argument('--no-prompt', action='store_true', help='应用运行时只准备文件，不弹出重启确认；脚本或自动化使用')
    args = parser.parse_args()
    try:
        result = run(args.action, args.app.expanduser().resolve(), args.data_dir.expanduser().resolve(),
                     args.remove_hook, args.no_prompt)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if result['state'] == 'prepared' else 0
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as cause:
        detail = getattr(cause, 'stderr', None)
        print(f'操作未完成：{cause}' + (f'\n{detail.decode()[:500]}' if isinstance(detail, bytes) else ''), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
