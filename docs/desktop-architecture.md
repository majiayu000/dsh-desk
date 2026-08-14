# DeepSeek Harness Desktop 架构设计

> 状态：设计基线，可开始 P0 技术验证
> 调研快照：2026-08-14；上游 `master` 为 `47f943859bef60e4160492346772ded9b24f765a`，npm 查询到 `@deepseek-ai/dsh@0.1.0-rc.6`。构建时必须重新核对并锁定同一份发布物。

## 1. 目标

为 DeepSeek Harness 提供一个可安装、可升级、可诊断的桌面产品，首发 macOS arm64，随后覆盖 macOS x64 与 Windows。桌面版复用上游 Harness runtime、会话日志、插件组合、设置、凭据和 React Web UI；本项目只拥有桌面生命周期、窗口、安全策略、打包、更新与诊断，不复制 agent loop 或另造一套会话状态。

MVP 的用户闭环是：安装应用 → 首次配置模型凭据 → 选择项目目录 → 创建会话 → 执行任务并审批工具 → 退出后安全保存 → 下次恢复。

## 2. 当前证据

这是一个空工作区，设计依据来自上游公开契约。

| 范围 | 证据 | 对桌面版的含义 |
| --- | --- | --- |
| 兼容入口 | `npx @deepseek-ai/dsh web` 启动完整 Web UI；CLI 支持 `--host 127.0.0.1 --port 0` | MVP 可把发布包作为受监管 runtime 启动，由 OS 分配随机端口 |
| 产品形态 | Harness 是 Cordis 驱动的“一切皆插件”系统；`web` profile = `base + web-app` | 桌面壳不应复制 core；桌面差异应放在 shell 或独立 profile/bundle |
| UI 与协议 | 上游已有 React UI、API Proxy、HTTP 上行和 WebSocket 下行 | MVP 可原样加载完整 UI，无需重写聊天、设置、会话、审批等页面 |
| 桌面适配位 | 上游 UI 与 runtime 已通过 API Proxy、HTTP 和 WebSocket 解耦；`dsh web` 能在随机 loopback 端口提供完整表层 | Tauri 只需监管 sidecar 并承载现有 Web UI，不需要实现新的业务协议 |
| 数据 | `$DSH_HOME` 是 Harness 数据唯一根；设置、凭据、会话分别由上游 provider 管理 | 默认使用桌面应用私有的 Harness home，避免与 CLI 的活动会话发生多 writer 竞争 |
| 凭据 | 当前本地 provider 使用 `0600` YAML，但文档明确说明同 UID/agent 工具仍可能读取，OS keychain provider 尚未实现 | MVP 必须如实展示风险；P1 增加系统钥匙串 provider，不能把文件权限宣传成安全隔离 |
| 错误语义 | 上游对非法配置、未知 provider、信任栅栏配置采取显式失败 | 桌面 launcher 必须 fail closed；禁止 warning 后加载默认全部插件、默认目录或未知模型 |
| 兼容风险 | 上游处于 developer preview，README 明示会有 breaking changes；当前 Git 与 npm 版本快照也不同 | UI、runtime、协议包必须作为一个原子版本集合发布并做契约门禁 |

主要来源：

- [上游 README](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/README.zh.md)
- [上游架构](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.zh.md)
- [Web server 边界](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/host/webserver/src/index.ts)
- [API Proxy 契约](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/host/apiproxy/README.zh.md)
- [凭据安全边界](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/credentials/credentials-local/README.zh.md)

## 3. 参考方案与选择

| 方案 | 借用 | 不采用的部分 | 结论 |
| --- | --- | --- | --- |
| Tauri 2 + Harness sidecar | 复用系统 WebView、壳体积和常驻内存较低、Rust 生命周期监管与 capability 权限清晰 | 不在 Rust 内重写 agent loop；不为“纯原生”重写 UI | **采用** |
| Electron + 受监管 runtime | 成熟的窗口、打包和更新生态；上游预留了未来 Electron IPC seam | 会额外携带完整 Chromium；当前 IPC seam 尚未实现，首版收益不足以抵消重量 | 不采用 |
| 浏览器/PWA | UI 零改动、交付快 | 不能可靠拥有 runtime 生命周期、签名更新、系统集成和离线安装 | 只保留为上游 Web 产品，不作为桌面版 |
| 重写原生 UI | 可完全控制体验 | 会复制高速变化的 Web UI、协议与状态投影，长期不可维护 | 不采用 |

## 4. 选定架构

**唯一状态所有权模型：Harness runtime 拥有所有持久业务状态与 agent 状态；Tauri Rust core 只拥有桌面应用和 sidecar 生命周期；WebView 只拥有临时视图状态。**

```text
Tauri Rust core（可信边界）
├─ WindowManager
├─ RuntimeSupervisor: stopped → starting → ready → stopping / failed
├─ SecurityPolicy
├─ Diagnostics
└─ UpdateCoordinator
          │ 启动/停止、stdout/stderr、健康探测
          ▼
Harness sidecar（固定 Node runtime + 同版本 dsh）
└─ @deepseek-ai/dsh web --host 127.0.0.1 --port 0
   ├─ Cordis plugin tree
   ├─ API Proxy
   ├─ session/settings/credentials persistence
   └─ built React frontend
          │ loopback HTTP + WebSocket（正式本地 adapter）
          ▼
系统 WebView（无 Node、无 Tauri remote IPC）
└─ 上游 Web UI
```

建议目录：

```text
src-tauri/
  src/
    app_lifecycle.rs
    runtime_supervisor.rs
    runtime_health.rs
    window_manager.rs
    security_policy.rs
    diagnostics.rs
    updater.rs
  capabilities/
  tauri.conf.json
src/
  bootstrap/
    index.html
    boot.ts
  shared/
    runtime-state.ts
    errors.ts
resources/
  runtime/
scripts/
  assemble-runtime.ts
  verify-runtime-closure.ts
tests/
  unit/
  integration/
  e2e/
```

本地 `bootstrap` 页面只负责“正在启动 / 启动失败 / 打开日志 / 重试”。runtime ready 后窗口导航到本次随机 loopback origin；不 fork 或复制上游 Web UI，也不向该 remote origin 暴露 Tauri command 权限。

## 5. 真源与版本策略

| 契约 | 唯一真源 | 消费方 | 禁止的副本 | 处理方式 |
| --- | --- | --- | --- | --- |
| Agent/session/tool 行为 | 打包进应用的 `@deepseek-ai/dsh` 发布物 | runtime、Web UI | 本项目中的 agent 状态或工具注册表 | 精确版本锁定，不重写 |
| UI/API wire schema | 与 runtime 同版的上游 client + API Proxy | WebView | 手写 DTO、宽松 JSON adapter | UI/runtime 原子升级 |
| 桌面生命周期 | `RuntimeSupervisor` 状态机 | main、bootstrap、测试 | 分散的 child-process flags | 所有启动/停止只经 supervisor |
| 用户业务数据 | Desktop 专用 Harness home | 上游 persistence providers | Tauri store 中的会话/凭据镜像 | Rust core 只保存路径和壳偏好 |
| 壳偏好 | Tauri app data 下的 desktop settings | Rust core | 写入 Harness `settings.yaml` 的窗口信息 | 与 Harness 配置分开 |
| runtime 版本 | lockfile + runtime manifest（版本、tarball integrity、构建 commit） | packager、诊断页、CI | `latest`、启动时在线安装 | 构建期固定，运行期离线 |

默认数据位置使用 `app.getPath('userData')/harness` 并显式设置 `DSH_HOME`。MVP 不与 `~/.dsh` 共用活动根；提供导出/导入说明。未来若提供“连接已有 CLI home”，必须先实现单实例/会话 writer 协调与冲突检测。

## 6. 边界契约

| 契约 | Owner | 允许依赖 | 禁止依赖 | 验证 |
| --- | --- | --- | --- | --- |
| 状态所有权 | Harness：业务；Rust core：runtime 生命周期；WebView：临时 UI | typed runtime state | WebView 直接写会话文件；Rust core 镜像 session | `runtime_state.rs`, `no-domain-mirror.spec.ts` |
| 启动 | `RuntimeSupervisor` | Tauri sidecar、随机端口、只读 manifest | shell 拼接、`npx latest`、固定 3080 | `runtime_start.rs` |
| Ready | `RuntimeHealth` | 解析严格的 `dsh web:` 行 + 实际 HTTP/`host.describe` 探测 | 只凭 stdout 或超时后继续显示 UI | `runtime-readiness.integration.ts` |
| 停止 | `RuntimeSupervisor` | 平台信号、上游 5 秒 graceful window、随后强制终止 | 直接退出 Rust core 留下子进程 | `runtime_shutdown.rs` |
| UI 导航 | `WindowManager` | 唯一 runtime origin、明确外链 handoff | 任意导航、新窗口、`file://` 任意读取 | `navigation-policy.e2e.ts` |
| WebView 权限 | `SecurityPolicy` | Tauri capability allowlist、本地 bootstrap commands | remote origin 的 Tauri IPC、任意 shell/文件系统 capability | `capability_policy.rs`, `remote-origin-deny.e2e.ts` |
| 配置/catalog | Harness provider + runtime manifest | schema 校验后的精确集合 | 解析失败后展示全部、回退未知 provider/model | `invalid-config.e2e.ts` |
| 凭据 | MVP 上游 local provider；P1 keychain provider | 上游 credentials seam | Rust core 读取/记录密钥明文 | `credential-redaction.spec.ts` |
| 日志 | `Diagnostics` | 分级结构化事件、滚动文件、redaction | prompt、凭据、完整工具输出默认落壳日志 | `diagnostic-redaction.spec.ts` |
| 升级 | `UpdateCoordinator` | 签名包、完整性校验、UI/runtime 同步替换 | 独立热升级某个上游包 | `update-compat.e2e.ts` |

### 6.1 启动协议

1. Tauri core 获取单实例锁；第二实例只激活已有窗口。
2. 校验 runtime manifest、入口文件与完整性；任何不一致直接进入 `failed`，不联网补装。
3. 创建 Desktop 专用 `DSH_HOME`，通过受限的 Tauri sidecar 启动固定 Node runtime 与 dsh：`dsh web --host 127.0.0.1 --port 0`。
4. 最多等待 20 秒读取严格格式的 `dsh web: http://127.0.0.1:<port>`；拒绝非 loopback host。
5. 对 origin 执行健康探测，再由 WebView 完成 `host.describe` 兼容检查。
6. 只有探测通过才导航主窗口；否则展示可复制的错误码、runtime 版本和日志路径。

### 6.2 失败策略

- `runtime-missing`、`runtime-integrity-failed`、`runtime-incompatible`、`runtime-bind-failed`、`runtime-timeout`、`runtime-exited` 均是用户可见的稳定错误码。
- runtime 崩溃后不无限自动重启。一次崩溃展示恢复页，用户可显式重启；连续三次失败进入安全停止状态。
- catalog、allowlist、plugin inventory 或配置解析失败必须阻止进入主 UI，并写诊断；不得 warning 后回退为“显示全部”或默认执行。
- 升级失败保留上一份完整可启动版本；不能留下新 UI + 旧 runtime 的混合状态。

### 6.3 安全基线

- Tauri capability 只授权本地 bootstrap 页面调用 `get_runtime_status`、`restart_runtime`、`open_diagnostic_folder`、`get_desktop_version`。
- 上游 loopback remote origin 不获得 Tauri IPC、shell、文件系统、opener 或 store 权限；其业务操作只走 Harness 自己的 `/api`。
- 仅允许导航到 supervisor 发布的单个 loopback origin；外部 `https:` 链接经 Rust 策略校验后交给默认浏览器，其余 scheme 拒绝。
- 禁用任意新 WebView；下载、文件打开和目录选择继续走上游受信任 Host 能力。
- CSP 以当前上游构建实际需求为准建立 allowlist，任何新增来源由测试显式批准。
- 诊断日志默认不记录 prompt、响应正文、API key、环境变量或完整工具输出。

## 7. 兼容桥与删除计划

| 临时路径 | 原因 | Owner | 保留条件 | 删除/收敛条件 |
| --- | --- | --- | --- | --- |
| Desktop 专用 `DSH_HOME` | 避免 CLI 与桌面共享活动 session writer | Rust core | 未有跨进程 writer 协调 | 有单实例 owner、冲突检测、迁移/回滚测试后再提供可选共享模式 |
| 文件型 credentials | 复用上游首版能力 | Harness provider | keychain provider 未实现 | macOS Keychain/Windows Credential Manager provider 通过 contract tests 后默认迁移 |
| 捆绑 Node + dependency tree | 上游当前以 npm/Node runtime 发布 | runtime packager | 上游没有稳定单文件发行物 | 上游单文件 runtime 通过插件、原生模块和核心旅程兼容矩阵后替换 |

loopback HTTP + WebSocket 是 Tauri WebView 与 Harness 的正式本地 adapter，不作为待删除的临时协议。它只绑定随机回环端口，生命周期完全归 supervisor；未来只有在上游提供同等成熟且更轻的官方 desktop carrier 时才重新评估，不能自行维护双协议栈。

## 8. MVP 产品范围

P0 必须包含：

- 单实例应用、启动页、主窗口和可靠退出。
- 内置并锁定同版本 DeepSeek Harness runtime + Web UI，完全离线启动。
- 上游已有的首次配置、模型选择、目录选择、会话、流式输出、工具审批、设置和恢复能力。
- runtime 崩溃页、可重试、可打开/导出脱敏诊断。
- macOS arm64 `.dmg`/`.zip` 构建，开发签名流程预留。

P0 不包含：tray 常驻、多窗口、自动启动、跨设备同步、内置终端重写、插件市场重写、共享 CLI home和系统钥匙串。

## 9. P0 / P1 / P2 路线图

| 优先级 | 工作 | 主要模块 | 完成定义 | 验证 |
| --- | --- | --- | --- | --- |
| P0.1 | runtime packaging spike | `scripts/assemble-runtime.ts`, `resources/runtime` | packaged app 在无全局 Node/npm/pnpm 环境下启动固定 runtime | `pnpm test:packaged-runtime` |
| P0.2 | supervisor 状态机 | `src-tauri/src/runtime_*` | 启动、ready、崩溃、重试、退出无僵尸进程 | `cargo test runtime_ --manifest-path src-tauri/Cargo.toml` |
| P0.3 | 安全 WebView 与 bootstrap | `window_manager.rs`, `security_policy.rs`, `capabilities`, `src/bootstrap` | 启动失败可恢复；remote origin 无 Tauri 权限；导航受控 | `cargo test security_ --manifest-path src-tauri/Cargo.toml && pnpm playwright test tests/e2e/startup-recovery.e2e.ts` |
| P0.4 | 上游核心旅程 | packaged E2E | 首次配置、选目录、建会话、流式响应、审批、重启恢复通过 | `pnpm playwright test tests/e2e/core-journey.e2e.ts` |
| P0.5 | 诊断与 macOS 产物 | `diagnostics.rs`, Tauri bundle config | 脱敏日志、版本清单、arm64 安装包可冷启动，并记录实际安装体积/冷启动内存 | `cargo test diagnostics_ --manifest-path src-tauri/Cargo.toml && pnpm tauri build --target aarch64-apple-darwin && pnpm test:smoke:artifact` |
| P1 | 签名更新、keychain、Windows/macOS x64 | updater、credentials plugin、CI matrix | 原子回滚、凭据迁移、三平台核心旅程通过 | `pnpm test:update && pnpm test:credentials-contract && pnpm test:e2e:platforms` |
| P2 | runtime 发行瘦身 | runtime assembler、官方单文件 runtime adapter | 不牺牲插件/原生模块兼容性地移除捆绑 dependency tree；旧路径删除 | `pnpm test:carrier-contract && pnpm test:packaged-runtime && pnpm test:artifact-size` |

## 10. 第一轮实施顺序

1. 建 Tauri 2 + Rust + TypeScript + pnpm 最小工程，不接业务 UI。
2. 做 packaged-runtime spike：捆绑满足上游 engines 的 Node，验证 `node-pty`、`koffi`、`node:sqlite` 和动态插件解析能从 Tauri resources 布局离线工作。
3. 完成 `RuntimeSupervisor` 与假的 runtime fixture，先把状态机、退出和错误页测稳。
4. 接入固定版本 `dsh web --port 0`，跑真实 readiness 和核心旅程。
5. 再做打包、签名、诊断、升级；不要在 runtime 可打包性尚未通过前投入 UI 美化。

## 11. 首轮决策门

开始大规模实现前，只需要确认两个产品选择：

1. **首发平台**：建议 macOS arm64；若首发即要求 Windows，P0 的 native module/签名验证矩阵需要从第一天并行建立。
2. **产品命名与分发主体**：暂用工作名 `DSH Desk`；正式名称、bundle id、签名证书主体和更新源必须在签名/自动更新前固定。

其余架构选择已经足够支持 P0，不需要等待新的上游桌面 transport。

## 12. Readiness

当前结论是：**架构设计已足以排序并启动 P0 技术验证，但尚不能声称桌面版可发布。** 最大风险不是 UI，而是 developer-preview runtime 的离线打包闭包、Node/原生模块跨平台分发、Tauri remote-origin 权限隔离，以及 UI/runtime 版本原子性；P0.1 必须先证明这些条件。
