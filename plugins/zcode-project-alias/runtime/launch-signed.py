#!/usr/bin/env python3
"""以独立应用责任归属启动官方 ZCode，保留继承的匿名管道。作者：Jason.chen。

macOS 的工具身份检查同时涉及签名与责任进程。外部启动器不应把自己的
责任身份传给另一个独立应用。本脚本让系统正常归责给实际签名的 ZCode，
不修改目标文件、签名、辅助服务、校验要求、信任名单或系统权限。
"""
import argparse
import ctypes
import os
from pathlib import Path
import subprocess
import sys


def launch(app, workspace=None):
    if sys.platform != 'darwin':
        raise ValueError('独立应用启动当前只支持 macOS')
    subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', '-R',
                    '=anchor apple generic and identifier "dev.zcode.app" and certificate leaf[subject.OU] = "8A5X4JJ39T"',
                    str(app)], check=True, capture_output=True)
    library = ctypes.CDLL('/usr/lib/libSystem.B.dylib')
    disclaim = getattr(library, 'responsibility_spawnattrs_setdisclaim', None)
    if disclaim is None:
        raise ValueError('当前系统不支持独立应用责任归属启动，已停止')
    attribute = ctypes.c_void_p()
    pointer = ctypes.POINTER(ctypes.c_void_p)
    library.posix_spawnattr_init.argtypes = [pointer]
    library.posix_spawnattr_setflags.argtypes = [pointer, ctypes.c_short]
    library.posix_spawnattr_destroy.argtypes = [pointer]
    disclaim.argtypes = [pointer, ctypes.c_int]
    library.posix_spawn.argtypes = [ctypes.POINTER(ctypes.c_int), ctypes.c_char_p, ctypes.c_void_p,
                                   pointer, ctypes.POINTER(ctypes.c_char_p), ctypes.POINTER(ctypes.c_char_p)]

    def check(result):
        if result:
            raise OSError(result, os.strerror(result))

    check(library.posix_spawnattr_init(ctypes.byref(attribute)))
    try:
        check(disclaim(ctypes.byref(attribute), 1))
        # Darwin sys/spawn.h: POSIX_SPAWN_SETEXEC = 0x0040。
        # 替换当前进程，PID 与 fd 3/4 保持；不留下 Python 监督父进程。
        check(library.posix_spawnattr_setflags(ctypes.byref(attribute), 0x0040))
        for descriptor in (3, 4):
            os.set_inheritable(descriptor, True)
        executable = app / 'Contents/MacOS/ZCode'
        args = [str(executable), '--remote-debugging-pipe']
        if workspace:
            args.append('--open-workspace=' + workspace)
        argv = (ctypes.c_char_p * (len(args) + 1))(*(os.fsencode(value) for value in args), None)
        env = [os.fsencode(key + '=' + value) for key, value in os.environ.items()]
        envp = (ctypes.c_char_p * (len(env) + 1))(*env, None)
        pid = ctypes.c_int()
        check(library.posix_spawn(ctypes.byref(pid), os.fsencode(executable), None, ctypes.byref(attribute), argv, envp))
        raise RuntimeError('系统未完成进程替换，停止启动')
    finally:
        library.posix_spawnattr_destroy(ctypes.byref(attribute))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--workspace')
    args = parser.parse_args()
    try:
        launch(args.app.resolve(), args.workspace)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
