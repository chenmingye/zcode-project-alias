# ZCode 项目昵称

为多份同名项目设置独立昵称，不改真实目录、Git/SVN 信息或会话归属。作者：Jason.chen。

首版 `0.1.0`。面向已安装并运行 **zcode-token-usage-statusbar** 的 ZCode Desktop；本机适配目标为 macOS ZCode **3.15.3 / 3.15.3.8237**。

## 使用

项目行右侧点击“昵称”，输入名称并保存。留空或点击“恢复原名”可还原。悬停项目行可查看真实路径。

本地项目按完整路径保存；远端按连接身份与路径隔离。昵称保存在当前 ZCode 客户端的 localStorage，跨窗口同步，关闭重开仍保留。清除应用网站数据或换应用配置目录会丢失这些昵称；不承诺跨设备同步。远端连接身份变化时可能需要重新设置。

## 免重启安装

先确保 Token 状态栏插件已经在当前 ZCode 进程中运行。仅安装了文件而尚未加载主进程注入器时，无法保证免重启生效。

在仓库根目录执行：

```bash
python3 plugins/zcode-project-alias/scripts/install.py doctor
python3 plugins/zcode-project-alias/scripts/install.py install
```

等待约 2–5 秒，检查左侧项目行出现“昵称”。不需要退出、刷新窗口或切换长任务。脚本输出 `live_verified: false` 表示只核实了磁盘状态，界面结果需要实际观察。

安装器需要 Python 3、Node.js。它会验证已有热加载器与 `hot_reload` 设置、校验合并脚本语法、备份原脚本后原子替换。不会修改 `app.asar`、数据库或业务项目，不开启调试端口，不联网。修改范围仅为 `~/.zcode/zcode-token-usage-statusbar/overlay.js` 末尾的本扩展片段、同目录的安装锁与 `project-alias-backups/`。

检查失败时会返回非零退出码，不会自动重启应用或修改 Token 插件配置。当前进程未加载热加载器时，应等长任务结束后再处理；不能用刷新或重启来强行验证。

## 作为插件添加

在 ZCode 插件市场添加 GitHub 仓库 `chenmingye/zcode-project-alias`，或添加本仓库的本地根目录（包含 `marketplace.json`），安装并启用 `zcode-project-alias`。也可以在 ZCode 对话输入：

```text
/plugin marketplace add chenmingye/zcode-project-alias
/plugin install zcode-project-alias@zcode-project-alias-marketplace
/project-alias-install
```

命令包没有 SessionStart 自动安装钩子；安装市场插件后需显式执行 `/project-alias-install`，或让 AI 运行上面的 Python 安装命令。已有会话尚未发现新命令时，直接运行 Python 即可，不必重载会话。此处的插件是分发与命令入口，昵称界面通过已有 Token 插件的客户端热加载器注入，并非官方项目改名 API。

## 卸载与兼容

```bash
python3 plugins/zcode-project-alias/scripts/install.py uninstall
```

或先执行 `/project-alias-uninstall`。约 2–5 秒后界面恢复，已保存昵称保留。卸载会在原脚本末尾留下一个清理调用，以便运行中的窗口热移除模块；原 Token 脚本内容逐字节保留。**只在插件市场禁用/卸载命令包不会自动撤销界面补丁**，应先执行热卸载。

首次及后续变更的完整原脚本备份放在 `project-alias-backups/`。正常卸载按标记移除自身片段，不直接恢复整个旧备份，避免覆盖 Token 插件后来的升级。

Token 插件升级可能替换 `overlay.js`，使昵称入口消失；重新执行 doctor/install 即可。安装器发现自身标记损坏或标记后有其他代码时拒绝覆盖。首版不修改 Token 插件的更新机制。客户端版本升级可能改变私有 React 节点与项目行结构；不兼容的项目行会跳过，不猜测名称、不修改宿主状态。

目前覆盖左侧“项目”视图的项目行；聊天头部、搜索结果、分组视图及系统标题仍显示宿主原名称。远端身份隔离已在浏览器 fixture 验证，真实 SSH/WSL/Docker 尚未实测。Windows 安装器暂不支持（使用 macOS/POSIX 文件锁）。

## 开发与实测范围

```bash
npm ci --no-audit --no-fund
npm run check
npm test
```

浏览器测试使用独立的无头 Google Chrome，默认读取 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`；其他环境可用 `CHROME_PATH` 指定。测试不连接用户浏览器，不修改本机 ZCode。开发依赖只有测试工具与真实 React fixture，运行时无 npm 依赖。

当前测试包括：同名不同路径、远端身份、同名任务不误改、保存不触发项目选择、React 重绘、跨窗口同步、新文档恢复、重复注入、恢复原名、取消、存储失败、移除再导入、卸载恢复，以及安装器的幂等、语法失败、损坏标记与热加载关闭保护。

本机只读核实了版本、项目行结构及热加载入口，尚未在正在运行的 ZCode 中安装或验收；安装交由用户指定的 ZCode AI 执行。

## 资料

- [官方插件开发](https://github.com/zai-org/zcode-plugins/blob/main/docs/PLUGIN_DEVELOPMENT_CN.md)
- [官方 UI Plugin 能力](https://github.com/zai-org/zcode-plugins/blob/main/UI_PLUGIN.md)
- [Token 状态栏插件](https://github.com/ByteRax/zcode-token-usage-statusbar)
- [Token 插件注入器](https://github.com/ByteRax/zcode-token-usage-statusbar/blob/main/inject-main.cjs)

给另一 AI 的完整安装任务见 [INSTALL-ZCODE-AI.md](INSTALL-ZCODE-AI.md)。
