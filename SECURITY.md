# 安全策略

DSH Desk 仍处于 alpha。请不要在公开 Issue 中提交 API Key、私有仓库内容、提示词、会话日志或可直接利用的漏洞细节。

## 报告方式

优先使用 GitHub 仓库的 **Security → Report a vulnerability** 私密报告。如果该入口不可用，请先创建不含利用细节的 Issue，请求维护者提供私密联系渠道。

报告应包含：

- DSH Desk、DeepSeek Harness、Node 与操作系统版本；
- 影响范围和最小复现条件；
- 是否涉及远端 origin 获得 Tauri IPC、任意导航、路径逃逸、签名绕过、runtime 篡改、插件脚本或凭据泄漏；
- 已做过的安全处理，避免其他用户误触。

## 安全不变量

- Harness 只绑定随机 `127.0.0.1` 端口；
- 远端 Harness 页面不获得 Tauri IPC；
- runtime 和上游版本固定，未知内容 fail closed；
- 插件安装必须检查并显式确认；
- 日志不得记录凭据、提示词和完整工具输出；
- 正式 Release 缺少平台签名凭证时必须失败。

尚未签名的 alpha 预览包不具备正式发行的信任级别。
