# 项目昵称

官方 UI Plugin，版本 0.7.0。照常使用原版 ZCode App 启动，在本地项目会话的「展开侧边面板 → 项目昵称」打开。

提供昵称编辑/恢复、置顶、搜索、添加文件夹和本地 SVN/Git 名称候选。昵称与置顶仅作用于插件面板，不能改变原生左侧项目列表，也不更改真实目录或聊天。

安装目录已包含 dist/server.mjs 和 dist/panel.html，无须 npm install 或额外界面安装步骤。也可用 /zcode-project-alias:project-manager 调用 open_project_manager 打开面板。

不创建额外 App，不修改 ZCode 应用包、不重签名、不注入主应用。不要运行旧 install.py 或 token overlay 安装脚本。

数据默认保存在 ~/.zcode/zcode-project-alias/panel/projects.json；卸载保留数据。完整说明及截图见仓库根 README.md。
