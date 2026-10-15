---
description: 免重启安装项目昵称，保留正在运行的长任务
---

安装本插件的项目昵称界面。先定位此命令所属的已安装插件目录，确认其中同时存在 `scripts/install.py` 与 `runtime/alias.js`，不要猜其他插件目录。执行该插件目录的 `python3 scripts/install.py doctor`，成功后执行 `python3 scripts/install.py install`。

此操作只向 `~/.zcode/zcode-token-usage-statusbar/overlay.js` 追加受标记管理的代码并备份，依赖已经运行的 Token 状态栏热加载器。不要退出、重启、刷新 ZCode，不要操作长任务，不要修改 app.asar、业务源码、数据库或设置。若 doctor 失败，报告具体原因并停止安装，不要通过重启解决。

安装后等候至少 3 秒，检查左侧项目行出现“昵称”按钮。有界面读取能力就检查；没有则明确报告“磁盘安装完成，界面待用户确认”，不要把磁盘状态当成热加载成功。不要自动给真实项目设置昵称。
