请安装并验证 ZCode 项目昵称独立扩展，不重新开发。此前长任务已结束，现在正式安装；无需再等待长任务。

来源：https://github.com/chenmingye/zcode-project-alias
使用 0.6.0 或更新的签名保留版本。先读 README.md 和插件清单，必须包含 runtime/companion.cjs、launch-signed.py、alias.js、name-suggestions.cjs 与 scripts/install.py。禁止使用会修改 app.asar、重签名的安装方案。

目标：项目行悬停后点击第一个“⋯”，提供置顶 / 编辑 / 移除；编辑弹窗修改昵称并显示只读的本地 SVN/Git 候选，支持填入和复制。保留原按钮、真实路径、会话归属与其他项目数据。

优先核对本机副本 /Users/Admin/Desktop/ai_project/Plugin_Workshop/zcode-project-alias；无副本则从上述仓库克隆。保护本地修改，不 reset/clean。以下命令均在实际仓库根目录执行，使用其他安装目录时先定位，不猜路径。

一、运行：
python3 plugins/zcode-project-alias/scripts/install.py doctor

核对应用版本、signature_verified、responsibility_verified、running_pids、live、live_verified、restart_required。目标为 macOS 官方 ZCode 3.15.3 / 3.15.3.8237，其他版本按实际验证。厂商完整签名不通过时停止安装，先用可信官方应用恢复；不能重签名或绕过校验。保留用户数据。其他插件若自动改写应用，也需先处理该自动注入；不要直接删除它们。

二、从个人插件中管理命令包：
/plugin marketplace add chenmingye/zcode-project-alias
/plugin install zcode-project-alias@zcode-project-alias-marketplace

已有安装则按市场更新流程更新同一插件，不重复注册。市场命令包不等于界面已加载。

三、安装自己的伴随启动器：
python3 plugins/zcode-project-alias/scripts/install.py install --no-prompt

这只写本插件运行目录与用户级启动器，不修改官方应用、不重签名、不开放网络调试端口。运行时需 Python、Node.js 和系统 codesign，不需要 npm install 开发依赖。

首次需通过 ~/Applications/ZCode 项目昵称.app 重新打开官方 ZCode，昵称启动器沿用原有账号、项目与会话数据。直接从原版图标启动不会自动加载昵称功能，以后请用昵称启动器，可拖到 Dock。

若应用已直接打开，--no-prompt 返回 prepared/退出码 2，只表示准备完成；不能冒称生效。用户打开昵称启动器后会看到“稍后 / 重新打开”确认，由用户点击后正常退出并重开，绝不强杀进程。如果用户已明确授权你正常退出，可在独立终端运行：
python3 plugins/zcode-project-alias/scripts/install.py install --restart --no-prompt

你若运行在 ZCode 内部，退出会结束自己，应先完成准备，一次给我包含真实绝对路径的独立终端命令，不能反复重试或擅自退出。长任务已完成不等于每个新会话都自动授权退出；以当前用户授权为准。

四、安装后重新 doctor，并在真实界面检查菜单、昵称保存与恢复、置顶取消、源文件夹、候选填入及复制。使用临时测试项目，不擅自修改真实业务项目，不点击真实项目“移除”。SVN/Git 仅本地只读，不更新、拉取、提交或运行业务脚本。

单独验证 Computer Use 的实际调用，例如只获取桌面状态，不修改文件或设置。应用签名通过、live_verified 或夹具截图都不能代替这一验收。没有工具或界面通道时明确写待验证，不能宣称全部通过。

五、停用及移除自己的启动器：
python3 plugins/zcode-project-alias/scripts/install.py uninstall

不退出客户端、不修改官方应用、不删除昵称数据。市场命令包可在个人插件中另外卸载。

交付用中文报告实际版本、安装目录、应用版本、执行命令与退出码、signature_verified、state、live_verified、restart_required、真实界面观察及 Computer Use 调用结果。真实未验证项必须说明。如果这是新对话，先核对本机状态再接手，不假定已经安装成功。
