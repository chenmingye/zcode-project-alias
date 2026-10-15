# ZCode 项目昵称 0.2.0

独立插件，无其他插件依赖。作者：Jason.chen。

在左侧项目的“⋯ 更多”菜单选择“重命名”，输入昵称保存。原“移除”操作保留；留空或“恢复原名”可还原。真实目录、仓库与会话归属不变。昵称按路径和远端身份保存在客户端 localStorage，同一配置下跨窗口同步，重开可恢复。

需要 macOS、Python 3.9+、Node.js 和 codesign；适配的项目行结构为 ZCode 3.15.3。运行时无需 npm 依赖。

在本插件目录执行：

```bash
python3 scripts/install.py doctor
python3 scripts/install.py install
```

首次安装遇到运行中的 ZCode 时只准备自己的文件，返回 prepared/退出码 2，不修改运行中的应用。等长任务结束并自行退出后，再执行 install，然后正常启动 ZCode。不要通过中断长任务、刷新或重载会话强行加载。

自己的加载器与配置位于 ~/.zcode/zcode-project-alias/。首次安装在 app.asar 追加自己的启动标记，更新 ASAR/Info.plist 完整性并建立本机 ad-hoc 签名，替换厂商签名；保留 entitlements 与硬化运行时 flags，不关闭完整性校验或修改 fuses。安装前备份应用相关文件，签名失败回滚。不读取或修改其他插件。

已启动独立加载器后，自己的界面脚本支持热更新；加载器本身更新需下次启动。客户端升级可能覆盖入口，需 doctor 后重新安装。

运行中停用：`python3 scripts/install.py uninstall`，约 2 秒内移除自身菜单项并恢复原显示，保留昵称。完整移除入口：应用退出后运行 `python3 scripts/install.py uninstall --remove-hook`。只在市场禁用/卸载命令包不会自动撤销客户端补丁。

当前覆盖左侧“项目”视图。其他标题和搜索结果仍显示原名。不要将磁盘入口已安装等同于真实界面验收通过；检查 doctor 状态并实际打开“更多”菜单确认。
