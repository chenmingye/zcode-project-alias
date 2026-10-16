---
description: 安装保留官方签名的项目昵称伴随启动器
---

定位本插件已安装目录，读取 README.md，确认 runtime/companion.cjs、launch-signed.py、alias.js、name-suggestions.cjs 与 scripts/install.py 齐全。

运行 `python3 scripts/install.py doctor`，确认 signature_verified 为 true；失败时停止，要求先恢复官方签名应用，禁止改包、重签名或绕过校验。

再运行 `python3 scripts/install.py install --no-prompt`。市场命令包管理版本，界面通过自己的 `~/Applications/ZCode 项目昵称.app` 启动器加载。启动器仍运行官方 ZCode，使用匿名管道，不开 TCP 调试端口，不借用其他插件。

返回 prepared/退出码 2 时说明尚未激活。用户打开昵称启动器后可点击“重新打开”完成正常退出和启动；未获得用户明确授权前，不使用 --restart，不退出当前 AI 会话。只有明确授权后才可在独立终端执行 `install --restart --no-prompt`。

确认真实菜单“置顶 / 编辑 / 移除”、编辑弹窗与仓库候选；不要擅自修改真实项目。单独记录 Computer Use 的真实调用结果，不以 doctor 或演示截图代替。不要运行 SVN 更新/提交、Git 拉取/提交或项目脚本。
