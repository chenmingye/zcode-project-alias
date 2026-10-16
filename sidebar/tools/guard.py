#!/usr/bin/env python3
"""启动守护：补丁部署后等待一次完整的「退出 → 重开」。

- 稳定启动（重开后存活 20 秒）→ 记录成功、保留补丁、退出。
- 启动异常（进程出现又消失）→ 自动还原原版 app.asar 并重新打开 ZCode。
- 用户还没重开 → 耐心等待，不打扰、不代操作。
"""
import datetime
import json
import os
import subprocess
import sys
import time

STAGE = '/Users/Admin/Desktop/ai_project/Plugin_Workshop/zcode-alias-nosign'
APP = '/Applications/ZCode.app'
DATA = '/Users/Admin/.zcode/zcode-project-alias'
LOG = STAGE + '/logs/guard.log'
PIDFILE = STAGE + '/logs/guard.pid'


def log(message):
    with open(LOG, 'a', encoding='utf-8') as stream:
        stream.write(f'[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {message}\n')


def app_pids():
    names = {APP + '/Contents/MacOS/ZCode', 'ZCode'}
    result = subprocess.run(['ps', '-axo', 'pid=,comm='], capture_output=True, text=True)
    pids = []
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[1] in names:
            pids.append(int(parts[0]))
    return pids


def notify(text):
    try:
        subprocess.run(['osascript', '-e', f'display notification "{text}" with title "项目昵称插件"'],
                       capture_output=True, timeout=20)
    except Exception:
        pass


def status_summary():
    try:
        folder = os.path.join(DATA, 'status')
        for name in os.listdir(folder):
            row = json.load(open(os.path.join(folder, name)))
            for window in row.get('windows', []):
                runtime = window.get('runtime') or {}
                if runtime.get('version'):
                    return f"插件已加载：UI {runtime['version']}，项目 {runtime.get('projects')} 个"
    except Exception:
        pass
    return '状态文件暂未生成（界面可能还在加载）'


def daemonize():
    if os.fork() > 0:
        sys.exit(0)
    os.setsid()
    if os.fork() > 0:
        sys.exit(0)
    os.chdir('/')
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)


def main():
    daemonize()
    with open(PIDFILE, 'w') as stream:
        stream.write(str(os.getpid()))
    log(f'守护启动（pid {os.getpid()}）：等待 ZCode 退出')
    while app_pids():
        time.sleep(2)
    log('ZCode 已退出，等待重新打开')
    while not app_pids():
        time.sleep(2)
    log(f'检测到重新打开（pid {app_pids()}），观察 20 秒稳定性')
    time.sleep(20)
    if app_pids():
        time.sleep(2)
        log('启动稳定：' + status_summary())
        notify('ZCode 已重新打开，侧栏昵称插件已生效；回会话说一声即可验证电脑操作能力')
    else:
        log('启动异常退出：自动还原原版 app.asar 并重新打开')
        subprocess.run([sys.executable, STAGE + '/patch-app.py', 'restore', '--app', APP,
                        '--backup-dir', STAGE + '/backup-live-app'], capture_output=True)
        subprocess.run(['open', '-a', APP], check=False)
        notify('启动异常，已自动还原原版并重新打开 ZCode')
    try:
        os.unlink(PIDFILE)
    except OSError:
        pass


if __name__ == '__main__':
    main()
