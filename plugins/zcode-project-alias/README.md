# ZCode 项目昵称

版本 `0.6.0`。独立伴随加载器，提供项目置顶、编辑昵称、本地 SVN/Git 候选名称。

不修改 ZCode 应用包、不重签名，需完整有效的官方厂商签名。安装后从 `~/Applications/ZCode 项目昵称.app` 打开官方客户端，沿用现有数据。直接从原版图标打开不自动加载昵称功能。使用匿名调试管道，不开放网络调试端口。

运行 `python3 scripts/install.py doctor` 检查，`python3 scripts/install.py install` 安装自己的启动器。客户端已运行时由用户确认正常重新打开；AI 使用 `install --no-prompt` 准备，不能把 prepared 当成生效。仅在用户明确授权正常退出后使用 `--restart`。

停用和移除自己的启动器：`python3 scripts/install.py uninstall`。不改动原厂应用，昵称数据保留。

完整说明与测试状态见仓库 README.md。本机已用 ZCode 自身的 Computer Use 成功读取应用列表、Finder 可访问性状态和 ZCode 主窗口真实截图；其他版本需重新验收，签名通过不能替代工具调用。
