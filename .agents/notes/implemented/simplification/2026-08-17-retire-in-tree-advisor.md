# Agent Note: Retire the in-tree advisor for the profile plugin

Status: implemented

English | [中文](2026-08-17-retire-in-tree-advisor.zh.md)

## Problem

The fork-local `@deepseek-ai/dsh-advisor` (`packages/core/advisor`) and the community [`dsh-advisor`](https://github.com/omdsh-dev/dsh-advisor) plugin both register loader entry id `advisor`. The loader rejects duplicate ids at boot, so the npm plugin cannot compose while the base bundle still carries the fork row. Keeping both also splits the reviewer: one copy is an unaudited in-tree package, the other is an OIDC-provenance npm release.

## Decision

`packages/core/advisor` is removed with its `dsh-base` row, dependency, and `tsconfig.host.json` reference. The reviewer is the per-profile [`dsh-advisor@0.2.0`](https://www.npmjs.com/package/dsh-advisor) plugin ([source](https://github.com/omdsh-dev/dsh-advisor)), installed with `dsh plugin --profile <name> add dsh-advisor`. The plugin defaults disabled; the home overlay sets `enabled: true` plus provider/model. `/api/advisor/set` sits behind the fork's `isTrustedApiRequest` fence (declared serving authorities only). The staging mirror keeps the old package as a rollback archive; `install.sh` strips rather than stages it. Inventory: [FORK.md](../../../../FORK.md).

## Alternatives considered

**Keep the in-tree package and skip the npm plugin.** Rejected: the npm release is the audited, provenance-signed reviewer; the in-tree copy cannot coexist with it.

**Rename the in-tree row so both can load.** Rejected: two reviewers on one turn is the wrong product, and the plugin already owns the `advisor` id.

**SHA-pin `dsh-advisor` into `third-party/` and mount it from `dsh-web-app`.** Rejected: the plugin is a per-profile choice (defaults disabled) and this host already installs it the same way as Codex/Grok.

## Consequences

A clone of this fork has no reviewer until the operator installs `dsh-advisor@0.2.0`. Rolling back means restoring the staging archive, re-adding the base-bundle row, and removing the profile bundle (ids collide). Canary-profile boot proved the duplicate-id refusal before the production profiles changed.
