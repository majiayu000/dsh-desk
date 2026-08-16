# 2026-08 发布文案（定稿候选）

状态：**待 majiayu000 逐字过目后方可对外发布**。所有外部发布动作（发帖、回帖）由维护者本人执行。

发布门禁（沿用 [launch-kit.md](launch-kit.md)，未满足前不发）：

- [ ] 干净机器“下载到首任务”不剪切录屏已发布（本文件中 `[视频]` 占位符替换为真实链接）；
- [x] 推荐版本 Release 完整（安装包、签名、SHA-256、latest.json）：`v0.1.0-alpha.11`
      已完成端到端发布验证，更新通道同步翻转（[Issue #20](https://github.com/majiayu000/dsh-desk/issues/20)）；
- [ ] 兼容雷达可访问且显示最新运行：<https://majiayu000.github.io/dsh-desk/>。

固定链接：

- 仓库：<https://github.com/majiayu000/dsh-desk>
- Release：<https://github.com/majiayu000/dsh-desk/releases>
- 兼容雷达：<https://majiayu000.github.io/dsh-desk/>
- 兼容矩阵与证据：<https://github.com/majiayu000/dsh-desk/blob/main/docs/compatibility.md>

## Show HN

标题：

> Show HN: DSH Desk – an installable, pinned-runtime desktop distribution for DeepSeek Harness

首帖说明：

> DeepSeek Harness is powerful, but a desktop app should not ask people to manage Node, npm, ports, and a runtime that can change under them.
>
> DSH Desk packages the official Harness UI with an exact, pinned runtime (`@deepseek-ai/dsh@0.1.0-rc.6`). The remote Harness page gets zero Tauri IPC capabilities, navigation is clamped to the exact runtime origin, and state lives in a private DSH_HOME. Every day, public CI re-verifies the pinned version and also tests the newest npm candidate — upstream drift shows up on the compatibility radar before it reaches user machines.
>
> Plugins get the same treatment: install review shows source, integrity, and lifecycle scripts before anything runs, with profile backup and rollback.
>
> `v0.1.0-alpha.11` is out for macOS (Developer ID signed + notarized), Windows (unsigned alpha; checksums and provenance attached), and Linux. Current limitations: Windows is not Authenticode-signed yet, and the "60 seconds to first task" figure is a target, not a benchmark — the clean-machine recording is the next launch gate.
>
> This is a community project, not an official DeepSeek product. I'd especially value clean-machine install reports and criticism of the update/security model.

## Reddit（r/LocalLLaMA、r/DeepSeek，按版规调整标题）

> I kept breaking my DeepSeek Harness setup whenever the runtime moved, so I packaged it properly: DSH Desk is a desktop distribution with the runtime pinned and bundled (no Node.js, no terminal). The official Harness web UI is untouched; the wrapper only owns process supervision, a random loopback port with a real health check, and a hard security boundary — the Harness page gets no desktop IPC at all.
>
> There's a daily public compatibility check (pinned version + newest npm candidate) so upstream breaks are visible before they hit your machine: radar link below. Plugin installs show source, integrity, and lifecycle scripts first, with rollback.
>
> Alpha builds for macOS (signed + notarized), Windows (unsigned alpha), and Linux are on the Releases page. Community project, not affiliated with DeepSeek. Clean-machine install reports very welcome.

（正文末尾附：仓库 / Release / 雷达 / [视频]）

## X / Twitter（串帖，3 条）

1. > DeepSeek Harness doesn't need you to manage Node, npm, ports, and runtime drift. DSH Desk pins the exact runtime, wraps the official UI, and gives the remote page zero desktop IPC. Daily public compatibility checks: [雷达]
2. > Every day, CI re-verifies the pinned runtime AND the newest upstream candidate. When DeepSeek ships a breaking change, the radar shows it before your machine eats it: [雷达]
3. > Alpha downloads are live: macOS signed + notarized, Windows + Linux installers, checksums and signed updater payloads. Watch a real download-to-first-task run: [视频] → [Release]

## V2EX（分享创造节点）

> 做了一个 DeepSeek Harness 的桌面发行版：DSH Desk。
>
> 起因是 Harness 本身迭代非常快（几天里连发了多个 rc，官方也明说会有破坏性变更），每次升级对普通用户都是一次环境赌博。DSH Desk 不改官方 UI，只把桌面这一层做可靠：固定并内置 Node 24 与精确版本的 dsh runtime，随机回环端口 + 真实健康检查，远端 Harness 页面拿不到任何 Tauri IPC 权限，数据放独立的 DSH_HOME。
>
> 比较特别的是兼容性当发布物管理：每天公开 CI 重新验证固定版本，同时把 npm 最新候选拉到临时环境跑同一套测试，结果实时更新在“兼容雷达”页面。插件安装前会展示来源、integrity 和生命周期脚本，失败自动恢复原 Profile。
>
> macOS 版已 Developer ID 签名 + 公证，Windows 是未签名 Alpha（Release Notes 里写了 SmartScreen 情况），Linux 有 AppImage/deb。均为 Alpha，欢迎干净机器安装报告和对更新/安全模型的批评。社区项目，与 DeepSeek 官方无关。
>
> [视频] / [Release] / [雷达]

## 掘金 / 知乎（长文骨架）

标题候选：《DeepSeek Harness 三天 12 万 star 之后，我给它做了一个“不会坏”的桌面发行版》

1. 开头：DSH 的爆点数据 + 用户真实痛点（安装劝退、上游破坏性变更、插件信任）；
2. 问题定义：为什么“桌面壳”真正难的不是窗口，而是 runtime 分发、安全边界和上游跟随；
3. DSH Desk 的四个设计决定（固定 runtime、零 IPC 边界、插件安装审查、每日公开兼容验证），每个附公开证据链接；
4. 与自装 CLI、其他桌面发行版的差异（引用[生态横评](ecosystem-review-v1.md)维度，不下竞品结论）；
5. 当前限制全量承认：Windows 未签名、Alpha 阶段、60 秒未实测、跨设备未接线；
6. 结尾：录屏 + Release + 雷达链接，征集干净机器安装报告。

## 发布节奏

沿用 [launch-kit.md](launch-kit.md) 的七日序列与分渠道测量表；每渠道的浏览、点击、下载、安装分别记录，
不合并互不兼容的流量来源。
