# Agent Note: Vet community plugins before composing

Status: implemented

[English](2026-08-16-community-plugin-vetting.md) | 中文

## 问题

一台通过 Tailscale 发布、持有文件、凭据和 git 的编程 agent，不能未审计就安装 GitHub 社区插件。Shai-Hulud 一类的 npm 蠕虫靠看起来合法的包上的 `preinstall` 传播。对某一个 SHA 的静态查看不是维护者身份或 install 脚本的保证，`dsh plugin add` / 浮动的 `github:` 别名会把下一次 bump 带进进程。

把每一个有用的社区插件都改写成第一方源码是另一种失败：太慢，也丢掉了 provenance 经得起检查的已知维护者的工作。

2026-08-16 对八个候选插件的审计发现该批次存在供应链和 Host 围栏缺口（provenance 缺失、install 生命周期风险，以及 `dsh-chat-import` 在 `/api` Host 围栏外注册 `/api-import/*`）。chat-import 和 compaction-instant 不进入活的 `dsh-web` 进程。该结论针对这些插件，不是针对社区插件这条路径。

## 决策

社区 DSH 插件仍是可安装选项。组装进本 fork 之前必须做安全审计：维护者身份与 provenance、install 生命周期脚本、`/api` 之外的 HTTP，以及进程/文件系统是否走 `ctx.subprocess` / `ctx.fs`。审计记录与组装变更放在一起。

通过审计的插件可以组装（钉住、经过审查）。未通过或显得有风险的插件不是 `file:` 依赖、不是 `dsh plugin add` 目标，也不是浮动的 `github:` / `npm:` 别名。若仍需要该能力，把该仓库当设计参考，在 `packages/` 下按 DSH 接缝改写第一方 workspace 包：HTTP 不离开 `/api`，没有 install 生命周期脚本，进程只通过 `ctx.subprocess` argv 启动，文件系统走 `ctx.fs`，配置在 cordis.yml。

chat-import 和 compaction-instant 不进入 `dsh-web-app`。tool-search、worktree、context、session-notification、AgentTeams 和 GenUI 通过了 SHA 钉住的审计，作为 SHA 钉住的 workspace 成员组装（[钉住清单](../../../../third-party/dsh-plugins/PINNED.md)）。`@deepseek-ai/dsh-client-ui-sticky-disclosure` 是第一个第一方改写（行为遵循 [dsh-sticky-disclosure](https://github.com/Han-1413141/dsh-sticky-disclosure)，MIT；源码是本仓库的原创 TypeScript）。已发布的 preset 继续 isolate `compaction-basic`。apiproxy 的 settings 白名单不暴露 `compaction-instant`。完整工作台清单（含仅 profile 安装的插件）见 [FORK.md](../../../../FORK.md)。

## 备选方案

**一刀切禁止：社区插件只当设计参考，永不进入运行时。** 否决：通过审计的知名维护者仍应能用；把我们可能想要的每个插件都改写成第一方太慢。

**凭那一次 SHA 快照组装这八个已审计插件。** 对本批次否决：provenance 缺失或不完整，且 chat-import 未加围栏的 HTTP 在 Tailscale Serve 上不可接受。

**不做审计就 `dsh plugin add` / 只用 home 覆盖层。** 否决：那是供应链路径，不是绕过审计的捷径。

**给 chat-import 加上 Host 围栏再移植。** 暂缓：带二十一个工具和出站同步的 13k 行导入器是一个产品。若以后要导入，会是小型离线或 `/api` 围栏内、根目录白名单的读取器，而不是移植那棵树。

## 影响

社区插件路径在审计之后仍然开放。chat-import 和 compaction-instant 在下一次通过审计或第一方改写之前不进入 `dsh-web-app`。tool-search、worktree、context、session-notification、AgentTeams 和 GenUI 按 [PINNED.md](../../../../third-party/dsh-plugins/PINNED.md) 的钉住 SHA 组装。sticky-disclosure 是第一方。DSH-better-sidebar 和 dsh-web-ui 皮肤库仍是 `~/Agent/Agent/plugin-review/` 下的设计参考。翻译配对把 `third-party/` 与 `vendor/` 同样对待：发现阶段跳过，不是产品双语源。更新未通过的社区 GitHub 仓库不会改变本进程；通过审计的 PR 或改写 PR 才会。
