# DSH Desk 多用户、多平台 Runtime 发行设计

> 产品约束：目标用户不需要理解 Node.js、npm、PATH、端口、进程、权限或日志。默认安装流程必须由应用自动完成；任何安全或兼容错误都 fail closed。

## 1. 产品结论

默认采用两层发行：

1. **轻量在线安装包**：Tauri 壳只携带启动与修复能力。首次运行自动下载当前平台的固定 runtime artifact，校验签名与 SHA-256 后原子安装。
2. **完整离线安装包**：携带同一份已签名 runtime artifact，供离线、受限网络或企业部署使用。体积更大，但行为和在线模式完全一致。

不采用以下面向最终用户的路径：

- 要求用户安装 Node、npm、pnpm 或执行终端命令。
- 运行 `npx latest` 或启动时从 npm 动态解析版本。
- 找不到 runtime 时回退到系统中任意 `node`/`dsh`。
- 多个 OS 用户共享同一可写 runtime、设置、凭据或会话目录。

当前代码中的系统 Node 查找只服务开发态和本机 debug 包；正式 release 构建必须关闭这条入口。

## 2. 每用户目录与所有权

安装程序可以按系统策略安装到共享只读应用目录，但所有可变内容必须在当前 OS 用户自己的 app-data 下：

```text
<user-app-data>/ai.deepseek.harness.desk/
  harness/                       # 该用户唯一 DSH_HOME
  desktop/settings.json          # 窗口与壳偏好，不存业务状态
  runtimes/
    active.json                  # 当前 release id，仅原子替换
    <release-id>/
      runtime-manifest.json
      node/...
      node_modules/...
  downloads/
    <artifact>.part
  locks/
    install.lock
  logs/
    desktop.log
    runtime.log
```

规则：

- macOS/Linux 目录权限为 `0700`，普通文件为 `0600`；Windows 使用当前用户 ACL。
- 不读取其他用户目录，不把用户 id、用户名或主目录写入下载 URL/遥测。
- 单实例锁按 OS 用户隔离；同一机器上的两个用户可以同时运行，各自使用随机 loopback 端口。
- runtime artifact 解压时拒绝绝对路径、`..`、符号链接逃逸、设备文件、重复路径和大小超限。
- 会话、设置与凭据只由该用户的 Harness runtime 写入；桌面壳不做镜像。

## 3. Runtime manifest 真源

桌面 release 内嵌一把只读 Ed25519 公钥和 manifest endpoint。HTTPS 只保护传输，签名才决定 artifact 是否可信。

```json
{
  "schemaVersion": 1,
  "releaseId": "dsh-0.1.0-rc.6-node-24.17.0-r1",
  "harnessVersion": "0.1.0-rc.6",
  "nodeVersion": "24.17.0",
  "desktopVersionRange": ">=0.1.0 <0.2.0",
  "publishedAt": "2026-08-14T00:00:00Z",
  "artifacts": {
    "darwin-aarch64": {
      "url": "https://downloads.example.invalid/runtime/darwin-aarch64.tar.zst",
      "bytes": 0,
      "unpackedBytes": 0,
      "sha256": "...",
      "signature": "...",
      "entry": "node/bin/node"
    }
  }
}
```

实现要求：

- manifest schema、release id、桌面版本范围、平台键、大小上限、SHA-256、签名全部验证后才下载或启动。
- 不认识的 schema/platform/catalog 必须报错，不能显示全部 artifact 或选择“最接近”的平台。
- 公钥轮换使用应用版本内的显式 key id allowlist；远端 manifest 不能自行授权新 key。
- artifact 必须把 Node、Harness、前端、原生模块及许可证作为一个版本闭包，禁止分别热升级。

## 4. 平台矩阵

| 平台键 | 安装产物 | 关键验证 |
| --- | --- | --- |
| `darwin-aarch64` | 签名/公证 `.dmg` + runtime | Apple Silicon、Gatekeeper、Keychain、路径含中文/空格 |
| `darwin-x86_64` | 签名/公证 `.dmg` + runtime | Intel、原生模块 x64、Rosetta 不被误选 |
| `windows-x86_64` | 签名 NSIS/MSI + runtime | WebView2、Defender、长路径、非管理员安装、Job Object 回收 |
| `windows-aarch64` | 仅在全部原生模块有 arm64 闭包后开放 | 禁止自动使用 x64 artifact；明确 unsupported |
| `linux-x86_64` | AppImage + deb/rpm | WebKitGTK 依赖、Wayland/X11、Zenity/KDialog、glibc 基线 |
| `linux-aarch64` | 原生模块闭包和 CI runner 可用后开放 | 不用 x64 模拟作为正式支持 |

支持矩阵是 allowlist。没有通过 artifact 构建、签名和核心旅程测试的平台返回 `platform-unsupported`，不能尝试通用包。

## 5. 首次启动状态机

```text
detect-platform
  → fetch-signed-manifest
  → select-exact-artifact
  → acquire-per-user-install-lock
  → download .part (可续传)
  → verify bytes + sha256 + signature
  → extract into <release-id>.staging
  → verify runtime closure and executable version
  → fsync + atomic rename to <release-id>
  → atomic switch active.json
  → start runtime
```

崩溃或断电后：

- `.part` 可按 ETag/Range 续传；服务器不支持续传时安全重下。
- `.staging` 永远不能作为 active runtime；下次启动清理过期 staging。
- active 切换只发生在完整验证后；失败继续使用上一份已验证 runtime。
- 保留当前与上一份 runtime；第三份在确认当前版本成功启动多次后再回收。

## 6. “傻瓜用户”交互

用户只看到四类状态：

1. “正在准备运行环境”——显示下载大小、进度、剩余时间和暂停/继续。
2. “网络暂时不可用”——提供重试、代理帮助、使用离线包；不显示 npm/Node 术语。
3. “安装包验证失败”——阻止启动，提供重新下载和导出诊断；不能忽略。
4. “当前系统暂不支持”——展示准确 OS/架构和受支持列表。

所有错误同时保留稳定错误码，UI 文案给用户看，诊断包给支持人员看。不得要求普通用户手工删除目录、改 PATH、改权限或复制终端命令才能恢复。

## 7. 稳定错误码

| 错误码 | 用户动作 | 禁止行为 |
| --- | --- | --- |
| `platform-unsupported` | 查看支持矩阵 | 下载其他架构试跑 |
| `manifest-unavailable` | 重试/代理/离线包 | 使用缓存外未知 manifest |
| `manifest-invalid` | 导出诊断/等待修复 | 忽略字段继续 |
| `artifact-download-failed` | 续传/重试 | 把部分文件当完整 artifact |
| `artifact-integrity-failed` | 删除该下载并重下 | 允许“仍然安装” |
| `runtime-install-locked` | 等待当前安装完成 | 并发写同一 runtime 目录 |
| `runtime-install-failed` | 回滚并重试 | 覆盖上一份可用 runtime |
| `runtime-start-failed` | 自动尝试上一已验证版本一次 | 无限重启循环 |
| `runtime-incompatible` | 更新桌面壳或 runtime | 混用不同版本 UI/API |

## 8. 进程与退出

- Unix：Harness 运行在独立 process group；退出向整个组发 SIGINT，5 秒后 SIGKILL。
- Windows：必须使用 Job Object 持有完整进程树；实现可等待的 graceful shutdown command 后再 terminate job。
- 应用崩溃后，下次启动清理由同一用户遗留且带本应用 owner token 的进程；不能按进程名批量杀 Node。
- 睡眠/唤醒、快速用户切换、关机、强制退出都必须进入平台 E2E。

## 9. 更新与回滚

- Desktop 与 runtime 各自有版本，但兼容范围只由签名 manifest 声明。
- 更新先下载后切换；运行中的会话不做热替换。
- 新 runtime 连续启动失败两次，自动回滚上一份并停止自动重试。
- 数据格式升级必须由 Harness 提供前向/回滚策略；没有回滚保证时先备份并明确阻止降级。
- catalog、allowlist、配置或凭据文档非法时 fail closed；不能 warning 后加载默认全部能力。

## 10. 发布门禁

每个平台 artifact 必须通过：

- 全新 OS 用户、无 Node/npm、无管理员权限的首次安装。
- 用户名/主目录/工作区包含中文、空格、emoji 和超长路径。
- 两个 OS 用户同时运行，数据、端口、锁和日志互不影响。
- 断网、代理、下载中断、磁盘满、只读目录、杀进程、断电恢复。
- manifest 篡改、artifact 篡改、错误架构、过大解压、zip-slip/symlink escape。
- 首次配置、目录选择、创建会话、流式响应、审批、重启恢复、卸载/重装。
- 关闭应用后没有监听端口、Node、shell、PTY 或工具子进程残留。

任何平台没有完成上述门禁，就保持 unsupported，不进入下载 manifest。
