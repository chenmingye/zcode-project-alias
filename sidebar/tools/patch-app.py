#!/usr/bin/env python3
"""保留厂商签名的补丁：只替换 app.asar 与 Info.plist 两个资源文件，不重新签名。

复用 0.5.1 安装器的 ASAR 追加逻辑（参考版仅作代码引用）。Mach-O 与
_CodeSignature 保持逐字节原样：把备份的两个资源文件放回，即可恢复为
完整有效的厂商签名。作者：Jason.chen（执行部分由 ZCode 会话编写）。
"""
import argparse
import importlib.util
import json
import os
import plistlib
import shutil
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load_reference():
    spec = importlib.util.spec_from_file_location('ref_installer', HERE / 'install-0.5.1-reference.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ref = load_reference()


def find_node():
    """launchd 的 PATH 很干净：显式查找 node（含 nvm 与 Homebrew 常见位置）。"""
    found = shutil.which('node')
    if found:
        return found
    candidates = []
    nvm = Path.home() / '.nvm/versions/node'
    if nvm.is_dir():
        candidates.extend(sorted(nvm.glob('*/bin/node')))
    candidates.extend(Path(p) for p in ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'])
    for path in reversed(candidates):
        if path.exists():
            return str(path)
    raise ValueError('找不到 node 可执行文件（语法校验需要）')


def status(app):
    _, _, _, archive = ref.app_paths(app)
    asar = ref.Asar(archive)
    _, payload, _ = ref.split_hook(asar.entry)
    print(json.dumps({'hook_installed': payload is not None, 'entry_length': len(asar.entry)}))


def apply(app, data_dir, backup_dir):
    # 只改 app.asar：Info.plist 的哈希在主程序签名里（CodeDirectory infoslot），
    # 改它会让系统在 exec 时杀掉进程；asar 只在资源信封里，实测可正常启动。
    _, _, _, archive = ref.app_paths(app)
    asar = ref.Asar(archive)
    entry = ref.hook_entry(asar.entry, data_dir)
    if entry == asar.entry:
        print(json.dumps({'state': 'already_patched'}, ensure_ascii=False))
        return
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / 'app.asar'
    if not target.exists():
        shutil.copy2(archive, target)
    fd, temp = tempfile.mkstemp(prefix='.noresign-', suffix='.asar', dir=archive.parent)
    os.close(fd)
    stage = Path(temp)
    try:
        asar.stage(entry, stage)
        with tempfile.TemporaryDirectory(prefix='noresign-syntax-') as folder:
            source = Path(folder) / 'entry.mjs'
            source.write_bytes(entry)
            subprocess.run([find_node(), '--check', str(source)], check=True, capture_output=True)
        os.replace(stage, archive)
    finally:
        stage.unlink(missing_ok=True)
    print(json.dumps({'state': 'patched', 'asar_only': True, 'plist_untouched': True,
                      'backup': str(backup_dir)}, ensure_ascii=False))


def restore(app, backup_dir):
    # 原子替换：应用运行时也能安全还原，运行中的进程继续用旧 inode。
    _, _, _, archive = ref.app_paths(app)
    fd, temp = tempfile.mkstemp(prefix='.noresign-restore-', suffix='.asar', dir=archive.parent)
    os.close(fd)
    stage = Path(temp)
    try:
        shutil.copy2(backup_dir / 'app.asar', stage)
        os.replace(stage, archive)
    finally:
        stage.unlink(missing_ok=True)
    print(json.dumps({'state': 'restored', 'asar_only': True}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'apply', 'restore'])
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--backup-dir', type=Path)
    args = parser.parse_args()
    if args.action == 'status':
        status(args.app.resolve())
    elif args.action == 'apply':
        apply(args.app.expanduser().resolve(), args.data_dir.expanduser().resolve(), args.backup_dir.expanduser().resolve())
    else:
        restore(args.app.resolve(), args.backup_dir.expanduser().resolve())


if __name__ == '__main__':
    main()
