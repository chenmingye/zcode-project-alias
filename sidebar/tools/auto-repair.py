#!/usr/bin/env python3
"""ZCode 升级后自动补回昵称插件（只改 app.asar，不重签）。

由 LaunchAgent 周期调用（登录时 + 每小时）：
- 插件已停用（enabled.json enabled=false）→ 不做任何事；
- 应用不是厂商签名 → 不做任何事（先在官方签名包上恢复）；
- 补丁标记存在 → 静默退出；
- 补丁缺失且应用完好 → 自动补回并弹系统通知（下次启动生效）。
日志：logs/auto-repair.log。
"""
import datetime
import json
import subprocess
import sys
from pathlib import Path

STAGE = Path('/Users/Admin/Desktop/ai_project/Plugin_Workshop/zcode-alias-nosign')
APP = Path('/Applications/ZCode.app')
DATA = Path.home() / '.zcode/zcode-project-alias'
LOG = STAGE / 'logs/auto-repair.log'
TEAM = '8A5X4JJ39T'


def log(message):
    (STAGE / 'logs').mkdir(parents=True, exist_ok=True)
    with LOG.open('a', encoding='utf-8') as stream:
        stream.write(f'[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {message}\n')


def notify(text):
    try:
        subprocess.run(['osascript', '-e', f'display notification "{text}" with title "项目昵称插件"'],
                       capture_output=True, timeout=20)
    except Exception:
        pass


def main():
    if not (STAGE / 'patch-app.py').exists():
        return
    try:
        if json.load(open(DATA / 'enabled.json', encoding='utf-8')).get('enabled') is not True:
            return
    except (OSError, ValueError):
        return
    try:
        status = subprocess.run([sys.executable, str(STAGE / 'patch-app.py'), 'status', '--app', str(APP)],
                                capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return
    if '"hook_installed": true' in status.stdout:
        return
    if not (APP / 'Contents/Resources/app.asar').exists():
        return
    signature = subprocess.run(['codesign', '-dv', str(APP)], capture_output=True, text=True).stderr
    if TEAM not in signature:
        log('应用缺少厂商签名，跳过自动补回（需先用官方签名包恢复）')
        return
    try:
        result = subprocess.run([sys.executable, str(STAGE / 'patch-app.py'), 'apply', '--app', str(APP),
                                 '--data-dir', str(DATA), '--backup-dir', str(STAGE / 'backup-live-app')],
                                capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.SubprocessError) as error:
        log(f'补丁执行异常：{error}')
        return
    if result.returncode == 0 and 'patched' in result.stdout:
        log('已自动补回：' + result.stdout.strip())
        notify('ZCode 升级后已自动补回昵称插件，下次启动生效')
    else:
        log(f'补回失败（退出码 {result.returncode}）：{result.stdout.strip()[:200]} {result.stderr.strip()[:300]}')
        notify('昵称插件自动补回失败，请查看 zcode-alias-nosign/logs/auto-repair.log')


if __name__ == '__main__':
    main()
