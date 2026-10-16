# 原生侧栏方案（保留厂商签名，Computer Use 完好）

「昵称插件第一版效果」：ZCode 原生左侧项目列表的「⋯ 更多」菜单提供置顶 / 编辑 / 移除，编辑弹窗可改昵称并从本地 SVN / Git 给出候选前缀；同时 **Computer Use 保持可用**。

2026-10-16 深夜在 macOS ZCode 3.15.3 / 3.15.3.8237 实机验证。

## 原理（为什么这样不破坏 Computer Use）

- 只改 `app.asar`：在入口追加一行加载器 import；**不碰 `Info.plist`、不重新签名**（厂商签名 `TeamIdentifier=8A5X4JJ39T` 原样保留）。
- `Info.plist` 的哈希在主程序签名里（CodeDirectory infoslot），修改它会让 macOS 在启动瞬间杀掉进程（实测 SIGKILL、exit 137）——这是"改 plist + ad-hoc 重签"路线必然破坏 Computer Use 的根源。
- `app.asar` 只在"资源信封"里、不参与主程序签名：补丁进程与原始进程的 `SecCodeCheckValidity` 校验（含 CUA 使用的默认校验）表现逐项一致。
- 实测 ZCode 3.15.3 未强制 asar 完整性校验；`patch-app.py` 只做安全的语法校验与原子替换，不关闭任何校验。
- 回滚 = 把备份的原版 `app.asar` 放回（一个文件，原子替换，运行中也能安全执行）。

## 目录

| 路径 | 说明 |
| --- | --- |
| `tools/patch-app.py` | `apply` / `restore` / `status`；`--app /Applications/ZCode.app --data-dir ~/.zcode/zcode-project-alias --backup-dir <备份目录>` |
| `tools/guard.py` | 一次性启动守护：补丁部署后等待退出重开，重开后 20 秒不稳定会自动还原并重开 |
| `tools/auto-repair.py` | ZCode 升级覆盖补丁后自动补回（LaunchAgent 登录时 + 每小时；三条件校验：插件未停用、应用为厂商签名、补丁确实缺失） |
| `tools/reference/install-0.5.1.py` | 供 `patch-app.py` 复用的 0.5.1 安装器参考代码（ASAR 读写逻辑） |
| `runtime/` | 0.5.1 运行时：`loader.cjs`、`alias.js`、`name-suggestions.cjs` |
| `launch/dev.zcode.project-alias.repair.plist` | 自动补回的 LaunchAgent（路径按本机部署目录书写，迁移时需同步） |
| `verify/check-sig.swift` | 签名等价性校验：`xcrun swift check-sig.swift <pid>` |

## 验证记录（2026-10-16 深夜）

1. **隔离副本预演**：只改 asar 的应用副本成功启动，插件完整注入（loader / UI 0.5.1、enabled）。
2. **对比实验**：改 `Info.plist` 的版本被系统 SIGKILL（exit 137）；只改 asar 的版本稳定运行。
3. **签名等价性**：`SecCodeCheckValidity` 对补丁进程与原始进程逐项一致（默认校验均 PASS）。CUA 实测：权限授权、列出 9 个应用、读取 ZCode 窗口完整 AX 树（199 个元素）全部成功，侧栏昵称（用户既有 `MES 5.5/touch` 等）正常显示。
4. **自动补回**：模拟升级覆盖后，LaunchAgent 自动检测并补回，厂商签名身份保持。

## 部署位置说明

本目录为版本管理副本；本机实际部署与自动补回使用 `~/Desktop/ai_project/Plugin_Workshop/zcode-alias-nosign/`（含 `backup-live-app/app.asar` 备份与日志，不入库）。迁移部署目录时，需同步修改 `guard.py` / `auto-repair.py` 中的 `STAGE` 常量与 LaunchAgent 路径。

## 停用与卸载

```bash
# 临时停用（自动补回也会一并停下）
echo '{"enabled": false}' > ~/.zcode/zcode-project-alias/enabled.json

# 移除自动补回
launchctl bootout gui/$(id -u)/dev.zcode.project-alias.repair
rm ~/Library/LaunchAgents/dev.zcode.project-alias.repair.plist

# 完整还原官方原版（随后重启 ZCode）
/opt/homebrew/opt/python@3.12/libexec/bin/python3 tools/patch-app.py restore \
  --app /Applications/ZCode.app --backup-dir <备份目录>
```
