# 贡献指南

## 开始之前

DSH Desk 的边界是桌面生命周期、runtime 分发、更新、诊断、安全策略和插件安装体验。Agent loop、会话、工具、设置和 Web UI 继续由上游 DeepSeek Harness 拥有；除非存在无法通过上游或插件解决的阻断，不在本仓库 fork 业务 UI。

提交 Issue 或 PR 前请先确认：

1. 问题属于 DSH Desk，而不是固定版本官方 Harness；
2. 没有把 API Key、提示词、工作区路径或完整工具输出放进日志和截图；
3. 新能力没有向远端 Harness origin 增加 Tauri IPC、shell 或文件系统权限；
4. 新依赖使用精确版本或锁文件，并说明供应链影响。

## 本地验证

```sh
npx --yes pnpm@11.7.0 install
pnpm check
pnpm test:rust
pnpm test:harness-contract
pnpm test:plugin-template
```

打包 runtime 和 parity 测试要求 Node 24：

```sh
pnpm prepare:runtime
pnpm test:packaged-runtime
pnpm test:plugin-parity
```

## PR 要求

- 一个 PR 解决一个可验证问题；
- 描述用户行为、失败策略、安全边界和验证命令；
- UI 改动提供真实截图或短视频；
- 兼容改动更新 `docs/compatibility.md`；
- 发布链路改动更新 `docs/release-signing.md`；
- 不绕过失败门禁来获得绿色 CI。

插件作者可以从 [`templates/dsh-plugin`](templates/dsh-plugin) 开始，或运行：

```sh
pnpm create:plugin ./my-plugin @your-scope/my-plugin
```
