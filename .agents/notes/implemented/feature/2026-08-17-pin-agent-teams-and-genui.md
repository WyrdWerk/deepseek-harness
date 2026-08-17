# Agent Note: SHA-pin AgentTeams and GenUI into dsh-web-app

Status: implemented

English | [中文](2026-08-17-pin-agent-teams-and-genui.zh.md)

## Problem

The live web GUI already used AgentTeams and GenUI, but the checkout did not pin or document them. Leaving them as floating `dsh plugin add` installs would reintroduce whatever the next registry bump ships, which is the supply-chain path the [vetting note](../process/2026-08-16-community-plugin-vetting.md) rejected.

## Decision

After the 2026-08-17 audit, both trees are SHA-pinned workspace members of `dsh-web-app`, remapped onto this workspace, with explicit Cordis rows. Do not `dsh plugin add` them.

- AgentTeams: [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) pin `9a743c3` (`dsh-agent-teams@0.1.5`, MIT) at `third-party/dsh-plugins/agent-teams/`. Host row `agent-teams` (`memberProvider: spawn`, state under `.agent-teams/`).
- GenUI: [omdsh-dev/dsh-genui](https://github.com/omdsh-dev/dsh-genui) pin `2187fa4` (`@omdsh-dev/dsh-genui@0.8.6`, MIT) at `third-party/dsh-plugins/genui/`. Host row `genui`.

Audit text: [AUDIT.md](../../../../third-party/dsh-plugins/AUDIT.md). Pins: [PINNED.md](../../../../third-party/dsh-plugins/PINNED.md). Inventory: [FORK.md](../../../../FORK.md).

## Alternatives considered

**Leave both as profile `dsh plugin add` installs.** Rejected: no extra HTTP, so they belong on the same SHA-pin path as context and session-notification; a floating alias is the thing the vetting policy exists to stop.

**First-party rewrite of both.** Rejected: the audits passed, and rewriting a whitelist UI renderer plus a team scheduler delays a capability we already run.

**Pin only one.** Rejected: both passed the same audit and both are already on the live GUI.

## Consequences

Both profiles that mount `dsh-web-app` get AgentTeams and GenUI without a second install. Bumping either pin requires a new audit row. Their upstream `cordis.patch.yml` files are not the compose path; `dsh-web-app` owns the rows so `dsh plugin add` cannot double-mount them.
