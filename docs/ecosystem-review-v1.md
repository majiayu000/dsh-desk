# DSH 桌面发行版生态横评 v1

本文件定义横评的维度、评级方法与初始快照。目标读者：想选一个 DeepSeek Harness 桌面发行版的用户，
以及想了解本仓库相对位置的贡献者。横评只使用公开可核验的证据（仓库元数据、Release 工件、
公开 CI 运行、项目文档声明），不安装、不反编译、不引用无法核实的宣传话术。

中立性声明：DSH Desk 是本仓库的项目，自评行同样只按证据打档；对其他项目仅记录公开事实，
星级与热度不代表推荐顺序。

## 为什么需要横评

DeepSeek Harness 开源后，桌面发行版在数天内大量出现。它们的第一屏价值主张高度相似
（免 Node、一键启动），真正影响长期可用性的差异集中在签名、上游跟随策略、安全边界和
验证证据上——这些恰好是 README 营销页不容易诚实表达的部分。横评把这些维度拉齐到同一张表。

## 评级方法

每个维度按四档评级，只认公开证据：

| 档位 | 含义 |
|---|---|
| `已证实` | 存在可链接的公开证据（Release 工件、CI 运行、配置文件、文档） |
| `声明未证` | 项目文档或 README 声称，但没有可核验证据 |
| `未提供` | 项目明确没有该能力，或能力仍在路线图 |
| `未知` | 公开信息不足以判断 |

## v1 维度

| # | 维度 | 测量内容 |
|---|---|---|
| 1 | 平台覆盖 | macOS arm64 / x64、Windows x64、Linux x64 的可下载安装包 |
| 2 | 签名与公证 | macOS Developer ID + notarization；Windows Authenticode；updater 工件独立签名 |
| 3 | 上游跟随策略 | 锁定精确 `@deepseek-ai/dsh` 版本，还是解析 `latest`；升级是否经人工复核 |
| 4 | 兼容验证证据 | 是否有公开 CI 在真实环境启动 runtime 并验证；是否有对 npm 最新候选的周期性公开测试 |
| 5 | 安全边界 | 远端 Harness 页面是否持有桌面 IPC / shell / 文件权限；导航是否限制到精确 origin；状态目录是否与 CLI 隔离 |
| 6 | 更新与回滚 | 更新包签名、通道单调性、失败后的恢复路径 |
| 7 | 插件信任 | 安装前是否展示来源、integrity、生命周期脚本；是否有失败恢复 |
| 8 | 安装形态与体积 | Tauri/Electron、是否携带完整离线 runtime、安装包体积 |
| 9 | 官方 UI 完整性 | 是否原样使用官方 Web UI，还是 fork / 换肤 / 私有 UI |
| 10 | 治理与诚实度 | 许可证、与官方关系的免责声明、文档是否承认当前限制 |

v1 为人工定档；v2 计划由兼容雷达扩展为自动化测量（安装包拉取、元数据与 CI 状态探测），
节奏先行每周更新，自动化后每日更新。

## 初始快照（2026-08-16）

静态快照，数据取自当日 GitHub 公开信息；星数为当日值，仅表示关注度。

| 项目 | Star | 一句话定位 | 备注 |
|---|---|---|---|
| anywhere-labs/deepseek-harness-desktop | 7,256 | 官网+社区运营最重的桌面端，路线图含手机远程、插件市场、IM 通道 | 核心卖点多为“即将推出” |
| zouyuxuan122/Deepseek-Harness-EAC | 381 | Windows/Linux 客户端，捆绑 Node，10 套 UI 皮肤 | 皮肤方向 |
| dataelement/dsh-desktop | 378 | 公司背景（Dify 团队），首日签名+公证，官网分发 | 产品化路线 |
| myYangyunfan/dsh_desktop | 330 | Windows 一键启动客户端 | 单平台 |
| hairyf/deepseek-harness-desktop | 211 | “仅 5MB”极简 Tauri，三平台 | 极简方向 |
| vibeinging/deepseek-harness-desktop-app | 207 | 会话/项目/文件工作台方向 | 偏离官方 UI 原样路线 |
| ChisaAlter/Deepseek-Harness-Desktop | 92 | Electron 壳，主题与背景个性化 | — |
| xingj404-lab/dsh-desktop | 58 | 早期桌面壳 | — |
| ningbainb/deepseek-harness-desktop | 53 | Windows 客户端，承诺 Codex/SSH/手机远程/11 皮肤 | 多为路线图 |
| majiayu000/dsh-desk（本项目） | 8 | 固定 runtime + 每日公开兼容验证 + 插件审查 + 签名更新 | 工程完整度高，分发薄弱 |

相邻但不同类：nexu-io/open-design（87K★，跨 20+ CLI 的设计插件，非桌面发行版）；
dshplugin.store 等第三方插件目录站（无验证机制）。

逐维度打档需要逐仓库取证，v1 快照先记录定位与热度；打档表随 v2 自动化一并发布，
避免本仓库手工给竞品逐项定性造成的不公平。

## 引用

- 上游仓库：<https://github.com/deepseek-ai/deepseek-harness>
- 本仓库兼容矩阵与每日验证：[compatibility.md](compatibility.md)
- 桌面架构与安全边界：[desktop-architecture.md](desktop-architecture.md)
