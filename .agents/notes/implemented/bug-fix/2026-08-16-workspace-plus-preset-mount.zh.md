# Agent Note: 预设行无法激活时，工作区加号无法新建会话

Status: implemented

[English](2026-08-16-workspace-plus-preset-mount.md) | 中文

## Problem

工作区行上的加号调用 `workspaces.startSession(workspaceId)`，进而 `session.create`。该 RPC 把会话的 agent preset 作为常驻组成挂载一次。预设中永远无法进入可用状态的行会让整次挂载失败（`dsh-agent-presets` 的 `inactiveRows`），客户端只打 `new session failed:` 日志——加号看起来像没反应。

本 fork 把 `tool-search-invariant` 写进了 `standard` / `code` / `cordis` 预设。它注入宿主 `invariants` 服务。`dsh-web` 并不组装该服务，于是该行一直等待。对工作区 `22ebe4ec-3e9b-4e8a-a8d7-6ebee93a544d` 的一次实况 `session.create` 返回 `agent-preset-invalid`，原因是 `waiting for invariants`。打开已在列表中的会话仍可能成功，因为列表/历史不会在每次点击时重挂失败的常驻组成；创建会话会。

`dsh-worktree` 还会在没有 isolate realm 的情况下 `ctx.provide("worktree", manager)`。去掉 invariant 行之后，这次发布会同样被 `leakedServices` 拒绝。

## Decision

从三份随附预设中删除 `tool-search-invariant`。该 companion 属于包含 `@deepseek-ai/dsh-invariants` 的测试组成；宿主上等待的行可以保持惰性，预设上等待的行会让挂载失败。在 worktree 行上设置 `isolate: { worktree: true }`，使其服务留在 entry-local realm。

## Alternatives considered

**在 web 宿主上组装 `@deepseek-ai/dsh-invariants`，让 companion 激活。** 拒绝：invariants 是本部署生产环境不运行的诊断注册表，为满足一个社区 companion 而拉进来是错误的平面。

**把 `tool-search-invariant` 做成 web-app 宿主行。** 拒绝：没有 `invariants` 它仍然等待；插件清单会永久显示一条无产品收益的 pending 行。

**在 pin 的树里删掉 `ctx.provide("worktree")`。** 拒绝：那会改 pin 应保持的上游行为；`isolate` 已是 `dsh-agent-presets` 文档中的预设侧约定。

## Consequences

工作区加号和其他 `session.create` 路径可以再次挂载 `code` / `standard` / `cordis`。这些预设上仍有 tool-search 渐进披露和 `/worktree`。`dsh-web` 不运行 `tool-search-invariant` 的选择快照检查。[AUDIT.md](../../../../third-party/dsh-plugins/AUDIT.md) 记录这两条组装规则。
