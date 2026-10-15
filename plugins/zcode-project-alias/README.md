# ZCode 项目昵称 0.1.0

项目行增加“昵称”按钮，按完整路径及远端身份分别保存显示名称。留空恢复原名。作者：Jason.chen。

需要：macOS/POSIX、Python 3、Node.js，以及当前 ZCode 进程中已经运行的 zcode-token-usage-statusbar 热加载器。已适配的客户端结构为 3.15.3。

在本插件目录运行：

```bash
python3 scripts/install.py doctor
python3 scripts/install.py install
```

或执行 `/project-alias-install`。等待 2–5 秒观察项目行；不退出、不刷新、不重启，不操作正在运行的长任务。脚本输出是磁盘状态，不能代替界面确认。若未出现按钮，报告状态并等待长任务结束后再排查，不通过重启强行验证。

安装会备份并修改 ~/.zcode/zcode-token-usage-statusbar/overlay.js 的末尾片段，保留原 Token 代码；不修改 app.asar、数据库或业务项目，不联网、不打开调试端口。备份位于同目录 project-alias-backups/，另有本插件安装锁文件。依赖未满足或脚本语法检查失败时拒绝替换。

卸载请先执行 `/project-alias-uninstall` 或 `python3 scripts/install.py uninstall`。这会热移除昵称界面并保留昵称存储，留下一个清理调用供已有窗口加载。只在市场禁用/卸载命令包不会撤销界面补丁。不要用旧备份整体覆盖 Token 插件新版本。

昵称存于客户端 localStorage，同一配置的窗口间同步，重开可恢复。清除应用存储或换配置会丢失昵称，不跨设备同步。Token 插件升级替换 overlay.js 后需重新 install。客户端结构变化时跳过无法识别的项目行。

首版仅覆盖左侧“项目”视图项目行，其他名称展示处仍为原名。远端身份隔离在真实 React 浏览器 fixture 验证，真实远端连接与本机 ZCode 热安装尚待实际验收。
