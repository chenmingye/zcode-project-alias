#!/usr/bin/env python3
"""安装/移除昵称热加载片段，不操作 app.asar 或运行中的会话。作者：Jason.chen。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import fcntl

BEGIN = b'\n/* BEGIN ZCODE PROJECT ALIAS v1 */\n'
END = b'\n/* END ZCODE PROJECT ALIAS v1 */\n'
CLEANUP = b';window.__zcodeProjectAlias?.dispose();'
ROOT = Path(__file__).resolve().parents[1]


def split_overlay(content):
    """严格识别自己拥有的末尾片段；标记异常时拒绝覆盖其他插件。"""
    if BEGIN not in content and END not in content:
        return content, None
    if content.count(BEGIN) != 1 or content.count(END) != 1:
        raise ValueError('昵称片段标记重复或不完整，请先检查 overlay.js；未修改文件')
    base, rest = content.split(BEGIN)
    payload, tail = rest.split(END)
    if tail:
        raise ValueError('昵称片段之后存在其他代码，拒绝覆盖；未修改文件')
    return base, payload


def validate_loader(token_dir):
    loader = (token_dir / 'inject-main.cjs').read_text()
    for anchor in ['hotReloadIfChanged', 'overlay.js', 'executeJavaScript', '2000']:
        if anchor not in loader:
            raise ValueError(f'Token 插件不支持已知热加载协议（缺少 {anchor}）')
    config_path = token_dir / 'config.json'
    config = json.loads(config_path.read_text()) if config_path.exists() else {}
    if not isinstance(config, dict):
        raise ValueError('Token 插件 config.json 格式错误')
    if config.get('hot_reload') is False:
        raise ValueError('Token 插件关闭了 hot_reload；请在长任务结束后处理，不会自动重启或修改配置')


def syntax_check(content):
    node = shutil.which('node')
    if not node:
        raise ValueError('缺少 Node.js，无法校验完整注入脚本；未修改文件')
    result = subprocess.run([node, '-e', 'new Function(require("fs").readFileSync(0,"utf8"))'],
                            input=content, capture_output=True)
    if result.returncode:
        raise ValueError(f'界面脚本语法校验失败；未修改文件：{result.stderr.decode()[:500]}')


def status(token_dir):
    content = (token_dir / 'overlay.js').read_bytes()
    _, payload = split_overlay(content)
    return {
        'transport': 'zusage-overlay-hot-reload',
        'state': 'installed' if payload is not None and payload != CLEANUP else 'uninstalled',
        'cleanup_marker': payload == CLEANUP,
        'matches_current_source': payload == (ROOT / 'runtime/alias.js').read_bytes(),
        'overlay': str(token_dir / 'overlay.js'),
        'overlay_sha256': hashlib.sha256(content).hexdigest(),
        'restart_required': False,
        'live_verified': False,
        'note': '这是磁盘状态；请在 ZCode 项目行确认“昵称”按钮，不刷新、不重启。',
    }


def update(token_dir, action):
    overlay = token_dir / 'overlay.js'
    if overlay.is_symlink():
        raise ValueError('overlay.js 是符号链接，拒绝替换；请检查真实安装目录')
    validate_loader(token_dir)
    # 此锁串行化本插件操作；额外比较源文件以发现其他更新器的并发写入。
    with (token_dir / 'project-alias-install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        old = overlay.read_bytes()
        base, previous = split_overlay(old)
        if action == 'uninstall' and previous is None:
            return status(token_dir)
        payload = (ROOT / 'runtime/alias.js').read_bytes() if action == 'install' else CLEANUP
        new = base + BEGIN + payload + END
        if old == new:
            return status(token_dir)
        syntax_check(new)
        backup_dir = token_dir / 'project-alias-backups'
        backup_dir.mkdir(mode=0o700, exist_ok=True)
        backup = backup_dir / f'overlay-{time.time_ns()}-{hashlib.sha256(old).hexdigest()[:12]}.js'
        backup.write_bytes(old)
        os.chmod(backup, 0o600)
        fd, temp = tempfile.mkstemp(prefix='.project-alias-', suffix='.js', dir=token_dir)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(new)
                stream.flush()
                os.fsync(stream.fileno())
            os.chmod(temp, overlay.stat().st_mode & 0o777)
            if overlay.read_bytes() != old:
                raise ValueError('Token 插件正在更新，源文件已变化；请稍后重试，未覆盖新内容')
            os.replace(temp, overlay)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
        result = status(token_dir)
        result['backup'] = str(backup)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['doctor', 'install', 'uninstall'])
    parser.add_argument('--token-dir', type=Path,
                        default=Path.home() / '.zcode/zcode-token-usage-statusbar')
    args = parser.parse_args()
    token_dir = args.token_dir.expanduser().resolve()
    try:
        validate_loader(token_dir)
        result = status(token_dir) if args.action == 'doctor' else update(token_dir, args.action)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (OSError, ValueError) as cause:
        print(f'操作未完成：{cause}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
