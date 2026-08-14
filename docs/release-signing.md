# 签名发布门禁

生产 Release 只由 `.github/workflows/release.yml` 从版本标签触发。工作流会先检查 `v<package.version>` 一致性和平台凭证，缺少签名材料时直接失败，不生成看起来像正式版的未签名资产。

## 自动更新签名

Tauri updater 使用一套独立于 Apple Developer ID 和 Windows Authenticode 的 minisign 密钥。公钥固定在 `src-tauri/tauri.conf.json`；对应私钥必须同时保留在安全备份和 GitHub Actions Secrets 中。丢失私钥或密码后，已经安装的客户端无法信任使用新密钥签署的更新。

- `TAURI_SIGNING_PRIVATE_KEY`：updater 私钥完整内容
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：私钥密码

当前维护机的加密私钥位于 `/Users/apple/.tauri/dsh-desk.key`，密码保存在 macOS Keychain 的 `dsh-desk-tauri-updater` service 下。私钥和密码都不得提交到仓库、Release asset、日志或工单。

正式构建会先用私钥签署测试载荷，并以配置中的公钥验证，密钥不匹配会在打包前失败。之后生成平台更新包和 `.sig`，`tauri-apps/tauri-action` 将它们连同 `latest.json` 上传到同一个草稿 Release。三个矩阵任务串行发布，避免并发覆盖 `latest.json` 中其他平台的记录。客户端只访问 HTTPS 地址：

```text
https://github.com/majiayu000/dsh-desk/releases/latest/download/latest.json
```

因此只有发布后的稳定 GitHub Release 会进入自动更新通道；draft 和 prerelease 不会被 `releases/latest` 选中。alpha/beta 通道必须使用单独的更新元数据地址，不能覆盖稳定通道。

在取得 Apple Developer ID 和 Windows Authenticode 证书前，可手动运行 `Update-capable unsigned preview` 工作流验证完整更新链路。它生成三平台未做系统身份签名的安装包，但 updater 包仍使用同一套 minisign 私钥签名；版本化资产发布到 `preview-v<version>`，通过校验的 `latest.json` 才会替换 `preview-channel`。该通道与正式 `releases/latest` 完全隔离。首次运行只建立当前版本基线；将三个版本文件同步递增后再次运行，旧预览版才能实际收到升级。

这类预览只用于测试：macOS 仍可能触发 Gatekeeper，Windows 仍可能显示 SmartScreen 警告。没有系统证书不影响 updater 对包内容做签名校验，但不能证明发行者的 Apple/Microsoft 身份。

桌面端在生产构建启动后检查一次，也可以从应用菜单选择“检查更新…”。用户确认后才下载；签名验证通过后先停止内置 Harness runtime，再安装完整桌面包并重启。WebView capability 不包含 updater 权限。

## macOS Secrets

- `APPLE_CERTIFICATE`：Developer ID Application `.p12` 的 Base64 内容
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_API_KEY_CONTENT`：App Store Connect `.p8` 的 Base64 内容
- `APPLE_API_KEY`
- `APPLE_API_ISSUER`

Tauri 使用 Hardened Runtime 完成签名并提交 Apple 公证。发布前还必须在干净 Mac 上人工验证 Gatekeeper、签名链、公证 ticket 与内置 Node runtime；CI 成功不能替代首次实机门禁。

本地正式构建也可以把 `.p8` 路径放入 `APPLE_API_KEY_PATH`；`APPLE_API_KEY_CONTENT` 仅用于 CI。`pnpm release:macos:preview` 会明确生成 ad-hoc 预览包，不能作为正式 Release。

## Windows Secrets

- `WINDOWS_CERTIFICATE`：Authenticode `.pfx` 的 Base64 内容
- `WINDOWS_CERTIFICATE_PASSWORD`

工作流把证书临时导入当前用户证书库，生成不入库的 Tauri Release 配置，使用 SHA-256 与 RFC 3161 时间戳签署 NSIS 安装包。

## Linux

Linux AppImage 与 deb 会生成 SHA-256，并由 GitHub OIDC artifact attestation 记录构建来源。它不等同于发行版仓库的 GPG 签名；进入 apt/rpm 仓库时必须再按仓库密钥和元数据规范签名。

## 发布前人工检查

1. 在无 Node/npm/pnpm 的全新系统用户下安装。
2. 验证签名主体、时间戳、公证或 Authenticode 状态。
3. 完成模型配置、首次任务、工具审批和重启恢复。
4. 验证卸载后没有进程与监听端口残留。
5. 核对 SHA-256、兼容矩阵、许可证清单和已知问题。
6. 草稿 Release 经人工确认后才能发布。
7. 从上一个正式版本检查更新，验证提示、签名下载、runtime 停止、安装和重启后的版本。
8. 将 `latest.json` 中的签名临时替换为无效值，在隔离测试 Release 中确认客户端拒绝安装。
