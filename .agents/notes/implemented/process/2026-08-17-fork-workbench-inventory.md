# Agent Note: FORK.md is the workbench inventory

Status: implemented

English | [中文](2026-08-17-fork-workbench-inventory.zh.md)

## Problem

The fork rule said every divergent commit must update `FORK.md`, but that file was only a commit table. Plugins lived on three shelves (checkout pins, per-profile installs, home overlay) and no one document listed every plugin, its upstream link, or how it was installed. Community work we adopted as design (sticky headers, failed-audit references) was easy to lose. An empty `rg` search was briefly treated as "not documented"; `rg` is not installed on this host.

## Decision

[FORK.md](../../../../FORK.md) is the complete current-state inventory: workbench profiles, three install shelves, every composed / profile-only / still-out plugin with upstream link and install method, adopted learnings, and the per-commit changelog. README banners point there and no longer claim in-tree OAuth or an in-tree advisor. Pin and audit files cover only shelf-1 trees. Profile-only plugins stay out of `dsh-web-app` and stay listed in `FORK.md`. Home `AGENTS.md` points at `FORK.md` so a later session does not have to rediscover the shelves.

## Alternatives considered

**Keep `FORK.md` as a commit table only and put the inventory in `docs/`.** Rejected: the fork rule already names `FORK.md` as the divergence contract; a second home would drift.

**Document only composed checkout plugins.** Rejected: the running GUI's Codex, Grok, advisor, and roster-manager plugins would stay invisible to the next agent.

**Generate the inventory from profile `package.json` files.** Rejected: those files are machine-local and must not be copied into the privacy fork; a hand-maintained inventory with public links is the durable record.

## Consequences

A later agent answers "what plugins do we run?" from `FORK.md` first. Adding a plugin without a `FORK.md` row is a process bug. `rg` absence is not evidence of missing docs; search the inventory file and the pin/audit pair.
