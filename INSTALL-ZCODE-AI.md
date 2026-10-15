请在当前电脑安装并验证“ZCode 项目昵称”插件。你可能正在另一个会话执行长任务；本任务不得中断它，也不要重启、退出、刷新或重载 ZCode、切换正在执行的任务、终止任何客户端/Agent/后端进程。

项目来源：https://github.com/chenmingye/zcode-project-alias
项目目录：使用该仓库的本地克隆目录；以下终端命令均在仓库根目录执行。没有本地副本时先从该地址克隆。
目标：在左侧“项目”视图的每个项目行增加“昵称”按钮，为同名项目设置显示昵称，保留真实路径与会话归属。插件已实现，无需重新开发。

一、先读取项目根 README.md。只操作昵称插件与它管理的 Token overlay 末尾片段；不要修改 fulgurjs-federation 或其他业务代码，不要提交代码、发布或更新依赖。

二、执行前检查：
python3 plugins/zcode-project-alias/scripts/install.py doctor

若命令失败，报告原始错误；不要为绕过失败修改 app.asar、打开调试端口、重载会话或重启 ZCode。此方案依赖当前进程已加载的 Token 状态栏热加载器；磁盘有插件不代表当前进程已加载。如果热加载入口不存在，本轮只保留代码和检查结果，待长任务结束后再处理。

三、doctor 成功后执行：
python3 plugins/zcode-project-alias/scripts/install.py install

记录退出码、state、matches_current_source 和 backup 路径。该命令会在 ~/.zcode/zcode-token-usage-statusbar/overlay.js 追加独立标记片段，校验完整脚本语法并备份，不修改客户端应用包或业务数据。安装不要求刷新或退出。

四、等待 3–5 秒后观察左侧“项目”视图的项目行是否出现“昵称”按钮。有现成的只读界面能力就检查；不要调用会改变运行任务的操作，不要发送测试消息。没有界面读取能力时明确报告“磁盘安装完成，热加载界面待用户确认”，不能把脚本成功当成界面验收通过。

五、需要在插件市场保留命令入口时，通过设置的插件市场添加本项目根目录，再安装 zcode-project-alias@zcode-project-alias-marketplace。也可使用当前客户端支持的命令：
/plugin marketplace add chenmingye/zcode-project-alias
/plugin install zcode-project-alias@zcode-project-alias-marketplace
注意：当前会话未发现新斜杠命令时，已执行 Python 安装仍然有效；不要重载正在执行的会话。市场安装是命令入口，实际界面注入由上面的 install 完成，不要重复安装 Token 插件。

六、不要自行给真实业务项目取昵称。告知用户点击项目行“昵称”，输入名称保存；留空或“恢复原名”可还原。真实昵称、清除及跨窗口同步可由用户在方便时测试，不能冒称已测过。

七、若安装引起界面异常，执行本扩展热卸载：
python3 plugins/zcode-project-alias/scripts/install.py uninstall
等待几秒检查恢复，不重启。该操作只替换本扩展片段为清理调用，保留 Token 插件原内容及昵称存储。不要直接把旧备份覆盖回整个 overlay.js，以免覆盖其他插件的新改动。若没有热加载效果则报告当前状态，不擅自操作应用进程。

验收标准：安装退出码为 0、state=installed、matches_current_source=true；项目行出现“昵称”，原 Token 状态栏继续正常；ZCode 没有退出、刷新或重载，长任务继续运行。未能观察的部分明确标为待确认。

最后报告：安装命令及结果、备份路径、实际观察到的界面结果、长任务是否保持原状、未验证项与具体问题。不要宣称已完成重启恢复、真实多窗口或远端验收，除非实际执行且不会影响长任务。
