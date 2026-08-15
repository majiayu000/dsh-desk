<p align="center">
  <img src="assets/dsh-desk-logo-anime-v1.png" width="132" alt="DSH Desk 小鲸鱼图标">
</p>

<h1 align="center">DSH Desk — DeepSeek Harness 桌面版</h1>

<p align="center"><strong>60 秒用上 DeepSeek Harness。无需 Node.js，无需终端，不赌 runtime 版本。</strong></p>

<p align="center">面向希望获得可安装应用、固定 runtime、可信插件审查和持续兼容验证的 DeepSeek Harness 用户。</p>

<p align="center">
  <a href="https://github.com/majiayu000/dsh-desk/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/majiayu000/dsh-desk/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/majiayu000/dsh-desk/actions/workflows/compatibility.yml"><img alt="Upstream compatibility" src="https://github.com/majiayu000/dsh-desk/actions/workflows/compatibility.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-4c6ef5.svg"></a>
</p>

<p align="center">
  <a href="https://github.com/majiayu000/dsh-desk/releases"><strong>下载预览版</strong></a> ·
  <a href="https://majiayu000.github.io/dsh-desk/">兼容雷达</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="docs/compatibility.md">兼容状态</a> ·
  <a href="README.md">English</a>
</p>

> [!IMPORTANT]
> DSH Desk 是社区项目，并非 DeepSeek 官方产品，也不代表或隶属于 DeepSeek。DeepSeek Harness 及相关名称、商标和代码归其各自权利人所有。

> [!NOTE]
> 产品目标是“DeepSeek Harness 最稳定、最省事、始终兼容官方的桌面发行版”。“始终兼容”由每日自动测试和公开矩阵约束，不是未经验证的宣传承诺。

> [!NOTE]
> “60 秒”目前是产品目标，不是尚未公开实测的性能结论。干净机器首次任务录屏与计时结果是下一次正式推广的发布门禁。

## 适合谁

- 想使用 DeepSeek Harness，但不想先安装 Node.js、配置 npm 或从终端启动服务的用户；
- 需要固定 Harness 版本、独立数据目录、崩溃恢复和可诊断桌面生命周期的用户；
- 希望在安装 DSH 插件前查看来源、integrity、生命周期脚本和回滚边界的用户。

如果你已经稳定使用官方 CLI，并且不需要安装包、桌面生命周期或插件审查，继续使用官方 Harness 会更直接。

## 为什么做 DSH Desk

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 已经拥有 Agent runtime、Web UI、会话、工具、审批、设置和插件协议。DSH Desk 不复制这些业务能力，只负责桌面产品必须可靠拥有的部分：

- 固定并携带 Node 24 与 `@deepseek-ai/dsh@0.1.0-rc.6`，普通用户不安装 Node、不敲命令；
- 随机 loopback 端口、真实 HTTP 健康检查和受监管的进程生命周期；
- 精确 origin 导航限制，远端 Harness 页面没有 Tauri IPC、shell 或文件系统权限；
- 独立 `DSH_HOME`，不污染已有 CLI 环境；
- 插件安装前检查来源、integrity 和生命周期脚本，失败后恢复原 Profile；
- 每日测试固定版本和 npm latest 候选，公开记录上游兼容状态。

## 当前下载状态

| 平台 | 当前状态 | 安装要求 |
|---|---|---|
| macOS Apple Silicon | `v0.1.0-alpha.1` 预览包 | 内置 runtime；当前尚未 Developer ID 签名和公证 |
| Windows x64 | 构建、runtime 与 Authenticode Release 门禁已配置 | 首次公开 CI 和签名实机门禁通过后发布 |
| Linux x64 | AppImage/deb 构建与 provenance 门禁已配置 | 首次公开 CI 和实机门禁通过后发布 |

Release 工作流缺少生产证书时会直接失败，不会把未签名资产伪装成正式版。最新事实以[兼容矩阵](docs/compatibility.md)和具体 [Actions 运行记录](https://github.com/majiayu000/dsh-desk/actions)为准。

## 快速开始

1. 从 [`v0.1.0-alpha.1` Release](https://github.com/majiayu000/dsh-desk/releases/tag/v0.1.0-alpha.1) 下载 macOS Apple Silicon 安装包。
2. 安装并启动 DSH Desk；应用自动验证并启动内置 Harness。
3. 官方 Harness 首次启动弹窗会要求配置可用模型；填写 API Key 并点击“保存并继续”，即可发送第一条任务。

预览版 macOS 用户若遇到 Gatekeeper 拦截，可在 Finder 中右键应用并选择“打开”。正式签名版发布后会删除这一步。

DSH Desk 不读取或保存模型 API Key；首次启动弹窗通过 Harness 官方只写 `credentials.set` 接口保存凭据，`settings.yaml` 不包含 Key。其安全边界见[桌面架构](docs/desktop-architecture.md)。

## 当前限制

- 公开下载目前只有 macOS Apple Silicon alpha，尚未发布 Windows、Linux 或 Intel Mac 安装包；
- 当前 DMG 尚未使用 Apple Developer ID 签名和公证，不能视为正式发行版；
- 离线包包含固定 Node.js 与完整 Harness runtime，当前 DMG 约 215 MB；
- DeepSeek Harness 仍处于快速变化阶段，每日兼容测试只能发现漂移，不能保证未来永不发生破坏性变更；
- 跨设备查看仍是实验协议，尚未连接真实 Harness 会话或生产云中继，远程审批未开放。

## 和其他方案有什么不同

| 方案 | 运行方式 | 是否修改官方 UI | runtime 策略 | 桌面权限边界 |
|---|---|---|---|---|
| 官方 DeepSeek Harness | CLI 启动本地 Web UI | 官方真源 | 用户管理 Node/npm | 浏览器环境，无原生桌面生命周期 |
| DSH Desk | Tauri 2 + 系统 WebView | 不修改 | 固定、离线、应用私有 | runtime 页面无 Tauri IPC，只允许精确 origin |
| Oh-DSH | Electron 社区发行版 | 有社区扩展 | 内置 Node/DSH | Electron sandbox，扩展能力和维护面更大 |
| 常见 Electron Desktop | Electron 封装 | 项目各异 | 多为内置 runtime | 携带 Chromium，签名和隔离质量取决于项目 |

DSH Desk 当前不宣称安装包最小：完整离线 runtime 会显著增加体积。“轻量”主要指不携带 Chromium和不 fork 官方业务 UI。

## 可信插件管理

从系统菜单选择 `DSH Desk → 插件管理…`：

1. 先在可信目录中搜索固定 Harness 已挂载的上游能力；目录会展示兼容版本、平台、能力和信任依据；
2. 经过审核的第三方条目将锁定精确版本，并从目录进入同一套安装审查；当前没有把未经验证的 GitHub 搜索结果放进市场；
3. 手动输入 npm、GitHub、TGZ 或本地目录来源时，查看包名、版本、repository、integrity、生命周期脚本和有效权限上限；
4. 明确确认后，Desk 才委托固定版本的原版 `dsh plugin --profile web` 执行；操作后组合配置验证失败会恢复操作前 Profile。

`dist.integrity` 是内容校验，不是维护者签名。DSH 目前也没有标准化插件权限 manifest，因此未知插件不会被标记为“安全”。完整模型见[插件信任与回滚](docs/plugin-trust.md)。

## 官方兼容如何验证

每次提交在 macOS arm64、Windows x64、Linux x64 运行：

- TypeScript 构建、Rust check 与单元测试；
- 真实启动 DSH，验证严格 loopback URL 和 HTTP 200；
- 组装不依赖系统 Node 的离线 runtime，再跑同一契约；
- 验证插件 add/why/update/remove 与官方 CLI parity。

每日任务还会临时安装 npm latest 候选执行同一组测试，但不会自动修改用户 runtime。详见[公开兼容矩阵](docs/compatibility.md)。

## 开发

开发环境固定使用 pnpm 11.7.0：

```sh
npx --yes pnpm@11.7.0 install
npx --yes pnpm@11.7.0 exec tauri dev
```

可用 `DSH_DESKTOP_WORKSPACE` 指定 Harness 初始工作目录：

```sh
DSH_DESKTOP_WORKSPACE=/path/to/project npx --yes pnpm@11.7.0 exec tauri dev
```

完整验证：

```sh
pnpm check
pnpm test:rust
pnpm test:harness-contract
pnpm prepare:runtime       # 必须使用 Node 24
pnpm test:packaged-runtime
pnpm test:plugin-parity
pnpm test:plugin-template
```

创建插件骨架：

```sh
pnpm create:plugin ./my-dsh-plugin @your-scope/my-dsh-plugin
```

## 路线与边界

- **当前重点**：签名、公证、三平台实机门禁、首次任务体验和兼容自动化。
- **下一步**：签名 runtime manifest、原子更新与回滚、可信精选插件 catalog。
- **实验项**：跨设备 Phase A 已有 E2EE 密文中继、可安装 PWA 与只读状态契约；尚未接入真实 Harness 会话或生产云服务，远程审批仍未开放。

项目不会为了演示速度静默安装 `latest`、向远端页面暴露桌面 IPC、明文记录 API Key，或把 GitHub Topic 当成已审核应用商店。

## 项目文档

- [架构与安全边界](docs/desktop-architecture.md)
- [runtime 分发与回滚契约](docs/runtime-distribution.md)
- [公开兼容矩阵](docs/compatibility.md)
- [签名发布门禁](docs/release-signing.md)
- [每周与每月发布节奏](docs/release-cadence.md)
- [插件信任模型](docs/plugin-trust.md)
- [真实增长指标](docs/product-metrics.md)
- [30 天执行计划](docs/30-day-plan.md)
- [发布传播素材](docs/launch-kit.md)
- [跨设备查看与审批安全协议](docs/cross-device-rfc.md)
- [贡献指南](CONTRIBUTING.md)
- [安全报告](SECURITY.md)

## 许可证

DSH Desk 自有代码采用 [MIT License](LICENSE)。作为依赖使用的 DeepSeek Harness 及其他第三方组件继续适用各自许可证。
