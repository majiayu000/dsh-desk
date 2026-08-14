# @dsh-desk/companion-status-plugin

DSH Desk Companion 的只读 Harness 状态插件。插件通过官方 `SessionStore`
事件面观察真实会话，不读取 JSONL、SQLite、终端输出、提示词或工具参数。

## 安装

```sh
dsh plugin --profile web add @dsh-desk/companion-status-plugin
```

DSH Desk 启动内置 Harness 时会注入两个仅限本机桥接器使用的环境变量：

- `DSH_DESK_STATUS_BRIDGE_URL`：固定为回环地址上的
  `/v1/harness/status`；
- `DSH_DESK_STATUS_BRIDGE_TOKEN`：每次桌面运行随机生成的短期 bearer
  capability。

任一变量缺失时，bundle row 会保持禁用。token 不进入
`cordis.patch.yml` 的配置值，因此 `dsh --dump-config` 不会打印它。

## 权限与数据边界

- 只监听 `session/created`、`session/event`、`session/disposed`；
- 只输出任务 ID、通用别名、状态、固定阶段、开始时间、耗时和稳定错误码；
- 不输出提示词、模型回复、工具名/参数/结果、路径、凭据或原始 session ID；
- 本地桥接失败不阻塞 Harness 任务。
