---
description: 停用项目昵称并移除自己的启动器，保留昵称数据
---

定位本插件目录，执行 `python3 scripts/install.py uninstall`。它停用自己的界面并移除用户级昵称启动器，不退出客户端，不修改 ZCode 应用包，不重签名，不删除昵称或业务数据。

随后运行 doctor，报告 enabled、live_verified 与签名状态。市场命令包可在个人插件中另外卸载；禁用命令包不等于已停用伴随界面。
