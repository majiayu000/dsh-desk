<p align="center">
  <img src="assets/dsh-desk-logo-anime-v1.png" width="144" alt="DSH Desk anime whale mascot logo">
</p>

<h1 align="center">DSH Desk</h1>

DeepSeek Harness 的轻量 Tauri 2 桌面壳。它使用系统 WebView，不携带 Chromium；Rust supervisor 负责启动和回收固定版本的 DeepSeek Harness，业务 UI、会话、工具、插件和设置继续由上游 Harness 拥有。

> [!IMPORTANT]
> DSH Desk 是社区项目，并非 DeepSeek 官方产品，也不代表或隶属于 DeepSeek。DeepSeek Harness 及相关名称、商标和代码归其各自权利人所有。

## 吉祥物

<p align="center">
  <img src="assets/dsh-desk-whale-girl-v1.png" width="420" alt="DSH Desk anthropomorphic anime whale navigator mascot">
</p>

鲸鱼娘是 DSH Desk 的副吉祥物与深海导航员；应用主图标仍使用更适合小尺寸显示的小鲸鱼形象。

## 当前能力

- Tauri 2 原生窗口与启动/失败恢复页
- 固定 `@deepseek-ai/dsh@0.1.0-rc.6`
- 随机 loopback 端口与真实 HTTP 健康检查
- 精确 origin 导航限制；远端 Harness 页面没有 Tauri IPC、shell 或文件系统权限
- 独立 Desktop `DSH_HOME`
- 默认以用户主目录启动，禁止意外使用 `/` 作为工作目录
- 单实例保护
- 退出时先优雅停止 Harness，超时后强制回收
- macOS 应用图标和 `.app` debug bundle

## 开发

本项目固定使用 pnpm 11.7.0，无需全局安装：

```sh
npx --yes pnpm@11.7.0 install
npx --yes pnpm@11.7.0 exec tauri dev
```

可用 `DSH_DESKTOP_WORKSPACE` 指定 Harness 初始工作目录：

```sh
DSH_DESKTOP_WORKSPACE=/path/to/project npx --yes pnpm@11.7.0 exec tauri dev
```

## 验证

```sh
npx --yes pnpm@11.7.0 run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --release --manifest-path src-tauri/Cargo.toml
npx --yes pnpm@11.7.0 exec tauri build --debug --bundles app
```

当前 macOS 测试产物：

```text
src-tauri/target/debug/bundle/macos/DSH Desk.app
```

诊断日志位于 Tauri 的应用日志目录；macOS 默认为：

```text
~/Library/Logs/ai.deepseek.harness.desk/runtime.log
```

## 发行边界

开发态和 debug bundle 从本工作区的 `node_modules` 启动 Harness。正式产品采用双发行模式：

- 默认轻量模式：首次启动自动下载经过签名与 SHA-256 校验的固定平台 runtime，不要求用户安装 Node 或打开终端。
- 离线模式：把同一份 Node 与 Harness dependency closure 一并签名打包；体积会显著增加，但无需网络。

当前代码在找不到明确 runtime 时会 fail closed，不会在线安装 `latest` 或回退到未知版本。

架构和后续路线见 [docs/desktop-architecture.md](docs/desktop-architecture.md)。
多用户、多平台与 runtime 安装/回滚契约见 [docs/runtime-distribution.md](docs/runtime-distribution.md)。

## 许可证

DSH Desk 自有代码采用 [MIT License](LICENSE)。作为依赖使用的 DeepSeek Harness 及其他第三方组件继续适用各自的许可证。
