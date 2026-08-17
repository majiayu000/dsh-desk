# DSH Desk 兼容矩阵

[![CI](https://github.com/majiayu000/dsh-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/majiayu000/dsh-desk/actions/workflows/ci.yml)
[![Upstream compatibility](https://github.com/majiayu000/dsh-desk/actions/workflows/compatibility.yml/badge.svg)](https://github.com/majiayu000/dsh-desk/actions/workflows/compatibility.yml)

DSH Desk 将桌面壳、Node、DeepSeek Harness 和 Web UI 作为一个固定版本集合验证。运行时不会解析 `latest`，也不会在失败后静默换用未知版本。

## 当前固定组合

| DSH Desk | DeepSeek Harness | Node | macOS arm64 | Windows x64 | Linux x64 |
|---|---|---|---|---|---|
| `0.1.0-alpha.12` | `0.1.0-rc.6` | `24.x` | 已验证 | 已验证 | 已验证 |

这里的“已验证”指该固定组合通过三平台 CI 契约：TypeScript/Rust 构建、固定 DSH 版本、严格
loopback 健康检查、离线 runtime 与插件 parity。最近一次公开运行（2026-08-17，版本准备 PR #35）：
[GitHub Actions #31998521392](https://github.com/majiayu000/dsh-desk/actions/runs/31998521392)。
每日兼容检查（含 npm `latest` 候选）最近一次成功运行：
[GitHub Actions #31990498493](https://github.com/majiayu000/dsh-desk/actions/runs/31990498493)。

`v0.1.0-alpha.12` 已完成端到端发布验证：preflight、macOS arm64/x64、Windows x64、Linux x64、
`Publish atomic release` 以及嵌套的 update-channel validate/publish 全部成功，共发布 18 个安装包、
updater、签名、SHA-256 与 `latest.json` 资产；`update-channel-alpha` 原子更新到
`0.1.0-alpha.12`（提交 `69d55f51c94765c8fea7b0c5ada4c852211a8cbc`），通道含 9 个平台键：
[Release v0.1.0-alpha.12](https://github.com/majiayu000/dsh-desk/releases/tag/v0.1.0-alpha.12) ·
[Release Actions #31999103490](https://github.com/majiayu000/dsh-desk/actions/runs/31999103490)。
macOS 含 Developer ID 签名、notarization 与 DMG 内容验证；Windows 为无签名的 Alpha 安装包。
验收清单见 [Issue #34](https://github.com/majiayu000/dsh-desk/issues/34)。

### 历史证据

三平台无系统签名 Preview 曾在同一公开运行中完成构建并上传 DMG、NSIS、AppImage 与 DEB：
[GitHub Actions #31864820646](https://github.com/majiayu000/dsh-desk/actions/runs/31864820646)。
当时的“已验证”表示固定 runtime、应用构建和安装包生成通过，不表示安装包已经获得 Apple
Developer ID 或 Windows Authenticode 签名。

独立的测试更新通道也已完成三平台更新包生成、更新签名校验、清单发布，以及 macOS
`0.1.0-alpha.2` 到 `0.1.0-alpha.3` 的下载、安装、进程退出、自动重启和版本切换验证：
[GitHub Actions #31864820646](https://github.com/majiayu000/dsh-desk/actions/runs/31864820646)。
该通道只用于验证更新基础设施，不会混入正式稳定更新端点。

`v0.1.0-alpha.10` 的四个平台打包 job 全部通过（含 macOS Developer ID 签名与 DMG 内容验证），
但 `Publish atomic release` 步骤失败。该缺口由 PR #19 与 PR #23 修复，修复后的链路已在
`v0.1.0-alpha.11` 标签上完成端到端验证。

## 自动门禁

每次 push 和 pull request 在三平台执行：

1. TypeScript 构建与 Rust `cargo check`；
2. Rust 单元测试；
3. 固定 DSH 的 CLI 版本、严格 loopback URL 与 HTTP 健康检查；
4. 组装不依赖系统 Node 的离线 runtime；
5. 使用打包 runtime 再跑同一契约；
6. 插件 add/why/update/remove 与原版 DSH parity。

每日任务还会查询 npm `latest`，在临时 CI 工作区安装候选版本并执行同一套测试。候选失败只表示“尚未兼容最新上游”，不会修改仓库锁定版本或用户机器。

## 更新规则

- 只有三平台固定版本门禁通过，才能发布桌面版本。
- 上游候选通过后仍需人工复核 Release notes、权限和数据迁移，再更新锁文件。
- 任何 UI/runtime 混合版本、未固定依赖或未知回退路径都视为不兼容。
- 公开矩阵以 GitHub Actions 的具体运行记录为证据；README 文案不得超前于它。
