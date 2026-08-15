# DSH Desk 兼容矩阵

[![CI](https://github.com/majiayu000/dsh-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/majiayu000/dsh-desk/actions/workflows/ci.yml)
[![Upstream compatibility](https://github.com/majiayu000/dsh-desk/actions/workflows/compatibility.yml/badge.svg)](https://github.com/majiayu000/dsh-desk/actions/workflows/compatibility.yml)

DSH Desk 将桌面壳、Node、DeepSeek Harness 和 Web UI 作为一个固定版本集合验证。运行时不会解析 `latest`，也不会在失败后静默换用未知版本。

## 当前固定组合

| DSH Desk | DeepSeek Harness | Node | macOS arm64 | Windows x64 | Linux x64 |
|---|---|---|---|---|---|
| `0.1.0-alpha.3` | `0.1.0-rc.6` | `24.x` | 已验证 | 已验证 | 已验证 |

三平台无系统签名 Preview 已在同一公开运行中完成构建并上传 DMG、NSIS、AppImage 与 DEB：
[GitHub Actions #31864820646](https://github.com/majiayu000/dsh-desk/actions/runs/31864820646)。
这里的“已验证”表示固定 runtime、应用构建和安装包生成通过，不表示安装包已经获得 Apple Developer ID 或 Windows Authenticode 签名。

独立的测试更新通道也已完成三平台更新包生成、更新签名校验、清单发布，以及 macOS
`0.1.0-alpha.2` 到 `0.1.0-alpha.3` 的下载、安装、进程退出、自动重启和版本切换验证：
[GitHub Actions #31864820646](https://github.com/majiayu000/dsh-desk/actions/runs/31864820646)。
该通道只用于验证更新基础设施，不会混入正式稳定更新端点。

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
