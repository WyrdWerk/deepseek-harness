# Agent Note: Retire the in-tree advisor for the profile plugin

Status: implemented

[English](2026-08-17-retire-in-tree-advisor.md) | 中文

## 问题

fork 本地的 `@deepseek-ai/dsh-advisor`（`packages/core/advisor`）与社区 [`dsh-advisor`](https://github.com/omdsh-dev/dsh-advisor) 插件都注册 loader 条目 id `advisor`。加载器在启动时拒绝重复 id，因此只要 base bundle 仍带着 fork 行，npm 插件就无法组装。两套并存还会拆开 reviewer：一份是未经审计的树内包，另一份是带 OIDC provenance 的 npm 发布。

## 决策

删除 `packages/core/advisor` 及其 `dsh-base` 行、依赖和 `tsconfig.host.json` 引用。reviewer 是按 profile 安装的 [`dsh-advisor@0.2.0`](https://www.npmjs.com/package/dsh-advisor) 插件（[源码](https://github.com/omdsh-dev/dsh-advisor)），命令为 `dsh plugin --profile <name> add dsh-advisor`。插件默认关闭；home overlay 设置 `enabled: true` 以及 provider/model。`/api/advisor/set` 走 fork 的 `isTrustedApiRequest` 围栏（仅已声明的 serving authority）。staging mirror 把旧包留作回滚档案；`install.sh` 只删除、不再暂存它。清单：[FORK.md](../../../../FORK.md)。

## 备选方案

**保留树内包、不用 npm 插件。** 否决：npm 发布才是经过审计、带 provenance 的 reviewer；树内副本无法与它共存。

**给树内行改名以便两套都能加载。** 否决：同一轮对话上两个 reviewer 是错误产品，且插件已经占用 `advisor` id。

**把 `dsh-advisor` SHA 钉进 `third-party/` 再从 `dsh-web-app` 挂载。** 否决：该插件是按 profile 选择的（默认关闭），本机已按与 Codex/Grok 相同的方式安装。

## 影响

克隆本 fork 在操作者安装 `dsh-advisor@0.2.0` 之前没有 reviewer。回滚需要恢复 staging 档案、重新加上 base-bundle 行，并移除 profile bundle（id 会冲突）。生产 profile 变更前，canary profile 启动已证明重复 id 会被拒绝。
