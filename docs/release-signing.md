# 签名发布门禁

生产 Release 只由 `.github/workflows/release.yml` 从版本标签触发。工作流会先检查 `v<package.version>` 一致性和平台凭证，缺少签名材料时直接失败，不生成看起来像正式版的未签名资产。

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
