请安装并验证已经实现的 ZCode 项目昵称独立插件，不重新开发。

来源：https://github.com/chenmingye/zcode-project-alias
使用版本：0.5.0 或更新的独立版本。先读取仓库 README.md 和插件清单核对版本，确认 runtime/name-suggestions.cjs 存在，不能使用旧的依赖版安装命令。以下终端命令均在本仓库本地克隆目录的根目录执行；没有副本时从上述来源克隆。已有副本若有本地改动先保护，不能 reset/clean 强行更新。

目标：左侧项目“⋯ 更多”菜单提供“置顶 / 编辑 / 移除”，在“编辑项目”弹窗中改名。置顶后显示“取消置顶”，项目排在当前列表顶部。昵称和置顶状态按真实路径与远端身份保存，不改目录、仓库或会话归属。不能安装、读取、修改或借用其他插件来实现加载。

当前可能有正在运行的长任务，严禁退出、重启、刷新窗口、重载会话、切换正在执行的任务或终止任何客户端/Agent/后端进程。不要修改业务代码、提交代码或更新依赖。此方案不承诺首次免重启：首次独立加载器只能在下次正常启动时载入。

一、先执行：
python3 plugins/zcode-project-alias/scripts/install.py doctor

doctor 是只读检查。核对应用版本、hook_installed/hook_matches、running_pids、live 和 live_verified；不把磁盘入口当成运行中的界面。失败时报告原始错误，不自行绕过 ASAR 校验、签名校验或修改 Electron fuses。

二、执行安装（AI 会话固定加 --no-prompt）：
python3 plugins/zcode-project-alias/scripts/install.py install --no-prompt

带 --no-prompt 时绝不弹窗：若客户端在运行，只准备本插件 ~/.zcode/zcode-project-alias/ 内的文件并返回 state=prepared、退出码 2，尚未修改应用。记录此结果并告知用户：方便时正常退出 ZCode 后重跑同一条命令即可完成，然后正常启动。不要在会话中触发重启路径——用户在自己的终端运行不带 --no-prompt 的 install 时，安装器会弹出“立即重启 / 稍后”确认框，确认后由安装器正常退出、完成安装并自动重开 ZCode；这条交互路径会终止当前会话，AI 不要调用。不要强杀或调用任何其他重启方法。不要把 prepared 当成已生效。

应用已退出时，install 会备份 app.asar、Info.plist、可执行文件与签名资源；只追加自己的 import、更新完整性并建立本机 ad-hoc 签名，替换厂商签名，保留原 entitlements/硬化运行时 flags；签名失败回滚。记录 backup 路径。该行为在 README 中有说明，不使用其他插件加载器，也不开放调试端口。安装器只在用户于确认框中同意后退出与重开应用，且只发送正常退出事件，不强杀进程。

已有本插件独立加载器时，界面脚本更新可在运行中热加载（0.5.0 的弹窗居中修复即属此类，不需要重启）；加载器本身变化须等下次启动。loader_restart_required 为 true 或候选区提示需要新版加载器时，不要冒称仓库识别已经生效。安装后重新 doctor，结合实际界面确认版本。

三、需要市场命令入口时，在 ZCode 插件市场添加仓库并安装：
/plugin marketplace add chenmingye/zcode-project-alias
/plugin install zcode-project-alias@zcode-project-alias-marketplace

仅市场安装不会自动注入界面。当前会话未发现新命令时直接运行 Python 即可，不重载会话。

四、在不影响长任务的前提下实际打开项目的“⋯ 更多”，确认有“置顶 / 编辑 / 移除”。不要自动给真实项目取昵称或改变置顶状态，不点击真实业务项目的“移除”。没有界面读取能力则明确写“界面待用户确认”。置顶、取消置顶、昵称保存、清除、跨窗口和重开恢复应由用户在方便时验证，未执行不能冒称通过。

进入编辑项目后还应确认候选名称区：本地 SVN/Git 信息只读识别，候选标明来源；点击填入前缀，复制按钮复制同一前缀，不自动保存。不要执行 svn update/commit、git pull/fetch 或运行项目脚本来辅助识别，也不要连接远程工作区的服务。缺少命令时报告目录候选回退；远程工作区不在本机识别。不要把“格式整理”的名称说成仓库原始名称。

五、回退使用：
python3 plugins/zcode-project-alias/scripts/install.py uninstall

它只停用本插件配置，自己的加载器约 2 秒内撤销界面；昵称保留。若要完整移除自己的入口，在应用完全退出后执行：
python3 plugins/zcode-project-alias/scripts/install.py uninstall --remove-hook

不要整体覆盖旧备份，不删除应用数据或操作其他插件。市场禁用命令包不会自动停用客户端补丁。

交付报告必须写明：版本、命令和退出码、state、入口状态、实际 live 状态、备份路径、真实菜单观察与未验证项。若 prepared，明确只完成准备，等待用户方便时退出后完成入口安装；不声称热加载成功。
