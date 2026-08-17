# Agent Note: Codex 与 Grok OAuth 离开检出树

Status: implemented

[English](2026-08-16-oauth-plugins-leave-the-checkout.md) | 中文

## Problem

`@deepseek-ai/dsh-llm-oauth` 借用 `~/.pi/agent/auth.json` 与 `~/.codex/auth.json` 中的令牌，且没有第一方登录。官方 DeepSeek Harness 没有增加替代的 LLM OAuth 包；它只有作为 *subagent* 后端的 Codex（`dsh-subagent-codex`）。社区 [`dsh-codex`](https://github.com/Yan-Zero/dsh-codex) 与 fork 本地的 `dsh-grok` 拥有各自的凭证文件和设备码登录，但两者都在 `/api` Host 围栏之外通过 `ctx.webServer` 注册 `/plugins/*/auth/*`。

把这些 bundle 组装进 `dsh-web-app` 会违反用于 chat-import 的社区插件 Host 围栏规则。把 `dsh-llm-oauth` 留在树里则会并存两套 OAuth。

## Decision

删除 `packages/llm/llm-oauth` 及其 `dsh-base` 行。ChatGPT OAuth 是 `dsh-codex@0.2.3`，Grok 是 `dsh-grok`，两者都装在 web profile 上（`dsh plugin --profile web add` / 对 staging mirror 的 `link:`），不是检出树的 workspace 成员。其路由仍只信任回环。树内 advisor 也已移除（与 profile 插件共用 loader id `advisor`）；reviewer 配置在 home overlay。见 [FORK.md](../../../../FORK.md)。

## Alternatives considered

**把 `dsh-codex` SHA pin、把 `dsh-grok` 拷进 `third-party/` / `packages/`，再从 `dsh-web-app` 挂载。** 拒绝：两者都在 `/api` 之外注册 HTTP。与 chat-import 相同的规则适用。本机已经通过 profile bundle 加载它们，不会双重挂载。

**在 profile 插件旁边保留 `dsh-llm-oauth`。** 拒绝：借用凭证且无登录 UI；同一订阅会出现两条路由。

**把登录改写成走 `/api` 的第一方实现。** 暂缓：带 Host 围栏的 OAuth settings RPC 是一项产品；profile 插件已经能登录。

## Consequences

克隆本 fork 不会自带 Codex/Grok OAuth 或 reviewer，除非操作者安装 profile 插件（`dsh-codex@0.2.3`、staging mirror 的 `dsh-grok`、`dsh-advisor@0.2.0`）。`dsh-web-app` 不再读取 pi 或 Codex CLI 的 auth 文件。[FORK.md](../../../../FORK.md) 记录这一拆分和安装命令。
