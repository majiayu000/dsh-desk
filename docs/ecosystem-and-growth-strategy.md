# DeepSeek Harness 桌面生态与 DSH Desk 增长策略

> 调研日期：2026-08-14
> 范围：官方 DeepSeek Harness、直接基于它构建的桌面项目，以及独立的 DeepSeek 向 GUI Harness。项目状态变化很快，采用前应重新核验版本、平台和发布资产。

## 结论

DeepSeek Harness 官方目前提供通过命令行启动的本地 Web UI，并明确处于 Developer Preview，后续可能发生破坏性变更。严格按“直接基于官方 DSH 的 GUI 或桌面项目”计算，目前主要有五个：

1. `majiayu000/dsh-desk`
2. `anywhere-labs/deepseek-harness-desktop`
3. `hust-open-atom-club/oh-dsh`
4. `Ruler4396/dsh-launcher`
5. `ChisaAlter/Deepseek-Harness-Desktop`

如果把面向 DeepSeek、但不基于 DSH 插件和运行时的独立实现 DeepTide 也计入，则共有六个相关项目。

这里需要区分两个层级：

- 官方 DSH 是 Agent Harness、运行时和插件协议的上游真源。
- DSH Desk 等桌面项目主要负责安装、窗口、服务生命周期和系统集成，不是新的 Harness。
- DeepTide 是另一套独立 Harness，属于替代关系，不是 DSH 的桌面入口。

## 项目对比

| 项目 | 定位 | 主要优点 | 主要缺点 |
|---|---|---|---|
| [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) | 官方 Harness 与 Web UI | 核心运行时、Agent Loop 和插件协议的上游真源；MIT；适合插件开发、服务器、远程环境和容器 | 处于 Developer Preview；可能发生破坏性变更；需要 Node/npm；缺少原生安装、托盘和桌面生命周期管理 |
| [majiayu000/dsh-desk](https://github.com/majiayu000/dsh-desk) | Tauri 2 轻量桌面壳 | 使用系统 WebView，不携带 Chromium；固定 DSH 版本；随机 loopback 端口、真实健康检查、精确 origin 限制和独立 `DSH_HOME`；未知 runtime 时 fail closed；退出时回收子进程 | 当前正式预览包主要覆盖 macOS Apple Silicon；尚未完成签名、公证、自动更新和跨平台 runtime 下载；仍处于早期版本 |
| [anywhere-labs/deepseek-harness-desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) | 官方 Web UI 的桌面封装 | 提供 macOS、Windows 安装包；内置运行环境；整合窗口、托盘和服务管理；普通用户上手成本低 | 桌面能力当前还未真正按 DSH 插件交付；插件市场等部分能力仍在开发；Linux 发行覆盖不足 |
| [hust-open-atom-club/oh-dsh](https://github.com/hust-open-atom-club/oh-dsh) | DSH 社区发行版 | Desktop、Web、Node runtime 和插件能力一体化；覆盖 Workspace、Terminal、Git Review、Browser 和插件生命周期；平台覆盖目标最完整 | 对上游的适配和维护面最大；同步及兼容风险较高；TUI 仍在规划；发布资产和文档宣称的平台覆盖需要逐版本核验 |
| [Ruler4396/dsh-launcher](https://github.com/Ruler4396/dsh-launcher) | Windows WebView2 轻量启动器 | 实现简单、改动少；保留官方 UI；支持开机启动、托盘、服务驻留和诊断日志；较容易跟随上游 | 仅支持 Windows；仍要求 Node.js；主要解决启动和窗口问题，对 Agent 工作流增强有限 |
| [ChisaAlter/Deepseek-Harness-Desktop](https://github.com/ChisaAlter/Deepseek-Harness-Desktop) | 深度修改的 Windows Electron 桌面壳 | 内置 Node；提供主题、背景、插件市场、第三方模型思考强度和视觉模型兜底 | 仅提供 Windows 正式安装包；直接 vendor 并修改上游，升级同步成本高；构建和发布体积较大；插件安装与视觉转交扩大了安全和数据边界 |
| [paean-ai/deeptide](https://github.com/paean-ai/deeptide) | 独立 Agent Harness | Swift 原生 macOS 版与 Rust/egui GUI；资源占用低；CLI 和 GUI 共享配置、会话及工具；不依赖 Electron/WebView | 不兼容 DSH 插件生态；配置、会话和工具协议是另一套；项目文案中的 “Built by DeepSeek” 不代表 DeepSeek 官方出品 |

## DSH Desk 当前优势

DSH Desk 已经选择了更可持续的技术路线：

- 保持薄壳，不重写官方业务 UI、会话、工具和插件系统。
- 使用 Tauri 和系统 WebView，安装体积与内存上限优于携带 Chromium 的 Electron 方案。
- 固定并校验 runtime，不在线安装 `latest`，避免上游变化导致不可复现故障。
- 将远端 Harness 页面与 Tauri IPC、shell 和文件系统权限隔离。
- 使用随机 loopback 端口、真实 HTTP 健康检查和明确的失败恢复页。
- 使用独立 `DSH_HOME`，避免污染 CLI 环境和用户已有配置。
- 插件操作复用固定版本的原版 `dsh plugin --profile web`，并通过 parity test 验证结果一致。

因此，DSH Desk 不应追求比所有竞品功能更多，而应强化“最轻、最安全、最可复现、最贴近官方”的定位。

## 推荐定位

> DeepSeek Harness 最轻量、最安全、始终可复现的桌面发行版。

对外传播时，应将这句话落实为可以验证的事实：安装体积、首次启动时间、空闲内存、固定 runtime 哈希、上游兼容矩阵和权限边界。

## P0：发布可信度

1. 完成 Apple Developer ID 签名和公证。
2. 提供 Windows x64 和 Linux x64 安装包。
3. 完成按平台 runtime 下载、签名、SHA-256 校验和原子安装。
4. 增加自动更新、失败回滚和版本锁定界面。
5. 公开 Desktop、DSH、Node 和 pnpm 的版本组合及兼容状态。
6. 启动、安装、升级或插件 catalog 失败时保持 fail closed，并展示可操作错误。

## P0：首次使用体验

目标是让用户在下载后 60 秒内完成第一个任务：

1. 安装并启动 DSH Desk。
2. 选择模型接入方式并填写必要凭证。
3. 选择工作目录。
4. 发送任务。

界面应自动完成 runtime 检查、端口选择、版本校验和服务启动。只有用户必须做出的选择才应暴露出来。

## P1：可信插件管理

插件管理不能退化为 GitHub Topic 浏览器。建议逐步增加：

- 安装前显示来源、解析后的包名、版本和将执行的生命周期脚本。
- 展示插件需要的文件、网络、命令和凭证权限。
- 对 npm、GitHub、TGZ 和本地目录显示不同的信任提示。
- 提供维护者身份、签名或社区验证状态。
- 记录兼容版本、最近验证时间和验证结果。
- 支持禁用、隔离、升级失败恢复和版本回滚。
- catalog 或 allowlist 读取失败时禁止展示未经验证的全量结果。

## P1：杀手级差异

完成发布基础设施后，只选择一个高价值能力优先做深。推荐“跨设备继续任务”：

- 电脑继续运行 Agent。
- 手机查看进度与工具调用。
- 高风险操作由手机审批。
- 用户从手机补充指令并继续原线程。
- 手机端不能扩大桌面端已经授予的权限。

它比主题和背景图更能解决真实问题，也比普通桌面封装更难复制。

## README 与发布策略

README 首屏应包含：

1. 一句话定位。
2. 20 至 30 秒真实演示视频。
3. 各平台下载入口。
4. 三步以内的首次使用说明。
5. 与官方 DSH、Oh-DSH 和其他 Desktop 项目的客观比较。
6. 安全边界、数据位置和凭证处理方式。
7. 插件开发和问题反馈入口。

发布节奏建议：

- 每周发布一个经过验证的小版本。
- 每月只突出一个用户能感知的主题能力。
- 官方兼容修复优先于普通功能，并单独发布。
- 每个版本提供演示、安装包、哈希、兼容矩阵、升级说明和已知问题。

## 社区增长

1. 帮助首批 20 个插件作者完成适配。
2. 提供插件模板、调试工具、自动测试和发布指南。
3. 建立经过真实安装验证的插件榜单。
4. 在 GitHub Discussions、DeepSeek 社区和开发者论坛发布可复现演示。
5. 对安装、升级和兼容问题保持快速、公开的响应。
6. 不购买 Star，不通过互赞或虚假账号制造热度。

## 核心指标

建议跟踪以下真实使用漏斗：

`下载安装 → 成功启动 → 配置模型 → 完成首次任务 → 7 日后继续使用`

| 指标 | 首阶段目标 |
|---|---:|
| 安装成功率 | ≥ 95% |
| 首次启动成功率 | ≥ 95% |
| 首次任务完成率 | ≥ 85% |
| 无崩溃会话占比 | ≥ 99% |
| 7 日留存 | ≥ 25% |
| 上游破坏性变化修复时间 | ≤ 24 小时 |

遥测必须明确告知用户并允许完全关闭，关闭后不得影响核心功能。

## 推荐执行顺序

资源有限时，依次完成：

1. macOS 签名、公证和自动更新。
2. Windows、Linux 安装包与固定 runtime 分发。
3. 上游兼容自动化和公开兼容矩阵。
4. 插件权限预览、隔离和回滚。
5. 手机查看、审批和继续桌面任务。
