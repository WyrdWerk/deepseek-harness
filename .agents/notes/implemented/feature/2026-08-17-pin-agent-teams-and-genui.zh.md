# Agent Note: SHA-pin AgentTeams and GenUI into dsh-web-app

Status: implemented

[English](2026-08-17-pin-agent-teams-and-genui.md) | 中文

## 问题

活的 Web GUI 已经在用 AgentTeams 和 GenUI，但检出树没有钉住也没有记录它们。若继续用浮动的 `dsh plugin add` 安装，下一次 registry bump 会直接进进程，而这正是[审计说明](../process/2026-08-16-community-plugin-vetting.md)否决的供应链路径。

## 决策

2026-08-17 审计通过后，两棵树都作为 `dsh-web-app` 的 SHA 钉住 workspace 成员，依赖重映射到本 workspace，并由显式 Cordis 行挂载。不要对它们执行 `dsh plugin add`。

- AgentTeams：[NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) 钉住 `9a743c3`（`dsh-agent-teams@0.1.5`，MIT），路径 `third-party/dsh-plugins/agent-teams/`。宿主行 `agent-teams`（`memberProvider: spawn`，状态在 `.agent-teams/`）。
- GenUI：[omdsh-dev/dsh-genui](https://github.com/omdsh-dev/dsh-genui) 钉住 `2187fa4`（`@omdsh-dev/dsh-genui@0.8.6`，MIT），路径 `third-party/dsh-plugins/genui/`。宿主行 `genui`。

审计正文：[AUDIT.md](../../../../third-party/dsh-plugins/AUDIT.md)。钉住清单：[PINNED.md](../../../../third-party/dsh-plugins/PINNED.md)。工作台清单：[FORK.md](../../../../FORK.md)。

## 备选方案

**两者都留在 profile 上用 `dsh plugin add` 安装。** 否决：它们没有额外 HTTP，应走与 context、session-notification 相同的 SHA 钉住路径；浮动别名正是审计政策要拦住的东西。

**把两者都改写成第一方。** 否决：审计已通过，重写白名单 UI 渲染器和团队调度器只会推迟我们已经在用的能力。

**只钉住其中一个。** 否决：两者通过同一次审计，且都已在活的 GUI 上。

## 影响

挂载 `dsh-web-app` 的两个 profile 都会得到 AgentTeams 和 GenUI，无需二次安装。升高任一钉住 SHA 都需要新的审计行。上游的 `cordis.patch.yml` 不是组装路径；行由 `dsh-web-app` 拥有，避免 `dsh plugin add` 双重挂载。
