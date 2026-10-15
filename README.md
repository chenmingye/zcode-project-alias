# ZCode 项目昵称

**独立插件，无其他插件依赖。** 左侧项目的“⋯ 更多”菜单提供“置顶 / 编辑 / 移除”，在“编辑项目”弹窗中修改名称。不改真实目录、仓库名称或会话归属。

版本 `0.3.0`。作者：Jason.chen。目前适配 macOS ZCode Desktop 3.15.3 的项目列表结构，其他客户端版本需重新验证。

## 使用

1. 在项目行点击“⋯ 更多”。
2. 点击“置顶”，将项目放到当前列表顶部；已置顶时显示“取消置顶”。多个置顶项目保留宿主原有相对顺序，取消后按宿主当前顺序显示。
3. 点击“编辑”，打开“编辑项目”弹窗，在里面修改名称并保存。
   下方“源文件夹”卡片只读展示真实目录名和完整路径；关闭、取消或按 Escape 均不保存。
4. 留空或点击“恢复原名”可还原；悬停项目行可查看真实路径。

昵称和置顶状态按完整路径与远端身份分别保存到当前客户端 localStorage。同一配置下的窗口间同步，重开客户端仍可恢复。清除应用存储、换配置目录或更换远端身份后可能需要重新设置。当前覆盖左侧“项目”视图，其他标题、分组视图和搜索结果仍由宿主显示原名称。

## 安装

需要 macOS、Python 3.9+、Node.js 和系统 `codesign`。没有其他插件也能安装、运行和卸载。运行时不需要 npm 安装依赖；仓库的 npm 依赖仅用于开发测试。

将本仓库克隆到本地后，在仓库根目录执行：

```bash
python3 plugins/zcode-project-alias/scripts/install.py doctor
python3 plugins/zcode-project-alias/scripts/install.py install
```

**首次加载独立入口需要正常启动 ZCode。** 若当前 ZCode 正在运行，安装器只准备本插件自己的文件，返回 `state: prepared` 和退出码 `2`，不修改运行中的应用、不退出或重启它。请等长任务完成后自行退出 ZCode，再执行 `install`，成功后正常启动。不能把 `prepared` 当成已经加载。

独立加载器已启动时，重新执行 `install` 可热更新自己的界面脚本；加载器本身变化仍需下次启动。安装器不会刷新窗口、切换任务或发送消息。

### 插件市场

```text
/plugin marketplace add chenmingye/zcode-project-alias
/plugin install zcode-project-alias@zcode-project-alias-marketplace
/project-alias-install
```

市场提供安装/卸载命令。当前会话未发现新命令时可直接运行上面的 Python 命令，不必重载会话。仅安装市场命令包不会自动修改客户端，也不会自动重启。

## 独立加载方式与文件范围

官方 UI Plugin 提供自己的交互面板，已查阅接口没有宿主项目菜单的扩展点，因此本插件使用独立的本地客户端补丁：

- 自己的运行目录：`~/.zcode/zcode-project-alias/`，包含 `loader.cjs`、`alias.js`、启停配置、状态文件与备份。
- 自己的启动标记：只在 ZCode `app.asar` 的主进程入口追加本加载器的 import，保留原入口其他内容。
- 更新受影响入口与 ASAR 头的 SHA256，并同步 `Info.plist` 完整性记录。应用资源变化后在本机重新建立 ad-hoc 签名，保留现有 entitlements 和硬化运行时 flags；这会替换厂商签名，不代表厂商签名仍然有效。
- 首次修改前备份 ASAR、Info.plist、可执行文件与签名资源；签名失败则回滚本次事务。不关闭 ASAR 校验，不修改 Electron fuses，不移除系统隔离属性，不开启调试端口。
- 不读取或修改任何其他插件的脚本、设置、加载器。自己的加载器只注入 ZCode 主界面，不注入外部网页、webview 或其他本地页面。

这是非官方客户端扩展。ZCode 自身升级可能覆盖启动入口；升级后先运行 doctor，必要时重新安装。项目行结构不兼容时会跳过，不按同名文字猜测项目、不写宿主业务状态。不要把本机修改后的应用包分享给其他人。

## 检查与卸载

`doctor` 只读检查应用、自己的入口与状态。`hook_matches` 表示磁盘入口就绪；`live_verified` 只有匹配当前进程的近期加载器状态确认界面版本后才为 true。最终仍应实际打开项目菜单确认“置顶 / 编辑 / 移除”。

运行中停用界面：

```bash
python3 plugins/zcode-project-alias/scripts/install.py uninstall
```

独立加载器会在约 2 秒内撤销自己的菜单项、恢复原名称和宿主顺序，保留已保存昵称与置顶状态。这个操作不退出 ZCode；自己的启动标记保留为停用状态。市场里禁用命令包不会自动撤销客户端补丁，应先执行本卸载命令。

要完全移除自己的启动入口，等长任务结束并自行退出 ZCode 后执行：

```bash
python3 plugins/zcode-project-alias/scripts/install.py uninstall --remove-hook
```

只移除本插件标记，不拿旧备份整体覆盖后来更新的应用。运行目录和备份仍保留，避免误删昵称和恢复证据。

## 开发与验证

```bash
npm ci --no-audit --no-fund
npm run check
npm test
python3 scripts/package.py
```

浏览器测试使用独立无头 Google Chrome，默认路径 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`，可用 `CHROME_PATH` 指定。测试不会连接用户浏览器，不修改本机 ZCode。

测试使用真实 React、Radix portal 菜单，覆盖置顶与取消置顶、编辑改名、原移除操作、键盘、同名项目隔离、远端身份、宿主重排、跨窗口、新文档恢复、取消、存储失败和卸载。独立加载器测试覆盖无其他插件时注入、热更新、停用及页面隔离。安装器在临时应用中验证入口、ASAR 完整性、运行中保护、失败回滚，并在 macOS 上验证临时应用的实际签名。

真实 ZCode 的首次启动与真实远端连接尚待用户在方便时验收；开发过程不会为此中断正在执行的长任务。

## 资料

- [官方插件开发](https://github.com/zai-org/zcode-plugins/blob/main/docs/PLUGIN_DEVELOPMENT_CN.md)
- [官方 UI Plugin 能力](https://github.com/zai-org/zcode-plugins/blob/main/UI_PLUGIN.md)
- [Electron ASAR 完整性](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)
- [给 ZCode AI 的完整安装任务书](INSTALL-ZCODE-AI.md)
