# DSH Desk launch kit

This file turns each verified release into a repeatable launch rather than a one-off link drop. Replace bracketed values only with evidence from the release being published.

## Non-negotiable launch gates

- A clean machine upgrades from the previously published version on macOS, Windows, and Linux.
- Download, updater signature, installation, restart, and final version are recorded separately.
- The recommended artifacts, signing status, checksums, compatibility matrix, known issues, and recovery path appear in one Release.
- A 20–30 second recording shows download to first completed task without cuts that hide setup.
- Claims in the post match the public Release and Actions evidence. Failed or untested platforms are named, not omitted.

## One-sentence position

**DeepSeek Harness in 60 seconds: no Node.js, no terminal, and no silent runtime upgrades.**

Until a clean-machine test supports the timing claim, use:

**DeepSeek Harness as an installable desktop app: no Node.js, no terminal, and no silent runtime upgrades.**

## Proof stack

Every launch should link these in this order:

1. real first-task video;
2. recommended Release;
3. live compatibility radar;
4. exact compatibility matrix and Actions run;
5. signing/checksum/provenance evidence;
6. known issues and recovery instructions.

## English launch post

### GitHub / X / Reddit

> DeepSeek Harness is powerful, but a desktop app should not ask people to manage Node, npm, ports, and runtime drift.
>
> DSH Desk packages the official Harness UI with an exact, private runtime. The runtime page receives no desktop IPC permissions, and every upstream candidate is tested publicly before it can reach users.
>
> [VERSION] is now available for [VERIFIED PLATFORMS]. Watch the real download-to-first-task run, inspect the compatibility evidence, or try the preview:
>
> [VIDEO]\n[RELEASE]\n[COMPATIBILITY RADAR]
>
> Current limitations: [SIGNING OR PLATFORM LIMITATIONS]. This is a community project, not an official DeepSeek product.

### Hacker News

Title:

> Show HN: DSH Desk – an installable, pinned-runtime desktop distribution for DeepSeek Harness

Opening comment:

> I compared the rapidly growing set of DeepSeek Harness desktop wrappers and kept finding the same hard problem: the window is easy; reliably distributing Node, Harness, updates, rollback, and a safe permission boundary is not.
>
> DSH Desk uses Tauri without forking the official Harness UI. It bundles an exact runtime, isolates its profile, gives the runtime page no Tauri IPC capability, and tests both the pinned version and the newest npm candidate in public CI. The project is early; [LIMITATIONS]. I would especially value clean-machine installation reports and criticism of the update/security model.

## 中文发布帖

### GitHub / V2EX / 掘金

> DeepSeek Harness 很强，但一个桌面应用不应该再让用户管理 Node、npm、端口和随时漂移的 runtime。
>
> DSH Desk 不修改官方 Harness UI，只负责把固定 runtime、桌面生命周期、更新回滚和权限隔离做好。远端 Harness 页面拿不到 Tauri IPC 权限；每个上游候选版本也会先经过公开兼容测试。
>
> [VERSION] 现已支持 [已验证平台]。这里有一条真实的“下载到完成首次任务”录屏，也可以直接检查兼容证据或下载体验：
>
> [视频]\n[Release]\n[兼容雷达]
>
> 当前限制：[签名或平台限制]。这是社区项目，并非 DeepSeek 官方产品。

### B 站 / 短视频脚本（25 秒）

| 时间 | 画面 | 字幕 |
|---:|---|---|
| 0–3s | 干净系统，没有 Node；打开 Release | “一台没装 Node 的电脑” |
| 3–8s | 下载并安装推荐包 | “下载 DSH Desk” |
| 8–14s | 首次启动，自动等待 runtime | “不用终端，不配端口” |
| 14–21s | 选择模型并发送真实任务 | “直接使用官方 Harness UI” |
| 21–25s | 任务完成 + 兼容雷达 | “版本固定，兼容状态每天公开验证” |

Do not hide Gatekeeper/SmartScreen warnings, credential setup, or long waits with cuts. Showing an honest limitation creates more trust than a polished but irreproducible demo.

## Seven-day launch sequence

| Day | Story | Evidence | Primary audience |
|---:|---|---|---|
| 1 | Download to first task | Uncut timer video | New Harness users |
| 2 | Why desktop packaging is a runtime problem | 22-project ecosystem analysis | Developers |
| 3 | What the remote UI cannot access | Capability files and architecture diagram | Security-minded users |
| 4 | Catching an upstream break before users do | Compatibility run and incident timeline | Existing Harness users |
| 5 | Clean-machine matrix | macOS/Windows/Linux results | Teams and maintainers |
| 6 | First verified plugin | Author repository, badge, regression evidence | Plugin authors |
| 7 | Honest launch report | Downloads, successful installs, failures, fixes | Community |

## Measurement sheet

Record by channel; do not merge incompatible traffic sources.

| Channel | Qualified views | Release clicks | Downloads | Confirmed installs | First tasks | D7 active |
|---|---:|---:|---:|---:|---:|---:|
| GitHub | | | | | | |
| X | | | | | | |
| Reddit / HN | | | | | | |
| V2EX / 掘金 | | | | | | |
| B 站 | | | | | | |

First experiment thresholds:

- release click-through from qualified visitors: at least 15%;
- 8 of 10 new users complete the first task without documentation;
- median first-task time at or below 60 seconds;
- every failed install has a stable category and a reproducible next step.

These are decision thresholds, not existing results. Publish observed denominators and failures alongside successes.
