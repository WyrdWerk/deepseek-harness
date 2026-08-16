# Agent Note: Workspace plus fails when a preset row cannot activate

Status: implemented

English | [中文](2026-08-16-workspace-plus-preset-mount.zh.md)

## Problem

The workspace-row plus button calls `workspaces.startSession(workspaceId)` → `session.create`. That RPC mounts the session's agent preset once as a standing composition. A preset row that never becomes usable fails the whole mount (`inactiveRows` in `dsh-agent-presets`), and the client only logs `new session failed:` — the plus looks like a no-op.

On this fork, `tool-search-invariant` was listed on the `standard` / `code` / `cordis` presets. It injects host `invariants`. `dsh-web` does not compose that service, so the row waited forever. A live `session.create` against workspace `22ebe4ec-3e9b-4e8a-a8d7-6ebee93a544d` returned `agent-preset-invalid` with `waiting for invariants`. Opening an already-listed session still worked because list/history do not remount a failed standing composition for every click; creating one does.

`dsh-worktree` also `ctx.provide("worktree", manager)` with no isolate realm. After the invariant row is gone, that publish would fail `leakedServices` the same way.

## Decision

Drop `tool-search-invariant` from the three shipped presets. The companion belongs in test compositions that include `@deepseek-ai/dsh-invariants`; a host row that waits is inert, a preset row that waits is fatal. Put `isolate: { worktree: true }` on the worktree row so its service stays in an entry-local realm.

## Alternatives considered

**Compose `@deepseek-ai/dsh-invariants` on the web host so the companion activates.** Rejected: invariants are a diagnostics registry this deployment does not run in production, and pulling them in to satisfy one community companion is the wrong plane.

**Mount `tool-search-invariant` as a web-app host row.** Rejected: without `invariants` it still waits; the plugin inventory would show a permanently pending row for no product gain.

**Remove `ctx.provide("worktree")` in the pinned tree.** Rejected: that edits upstream behavior the pin should keep; `isolate` is the preset-side contract `dsh-agent-presets` already documents.

## Consequences

Workspace plus and other `session.create` paths can mount `code` / `standard` / `cordis` again. Tool-search progressive disclosure and `/worktree` remain on those presets. Selection-snapshot checks from `tool-search-invariant` do not run in `dsh-web`. [AUDIT.md](../../../../third-party/dsh-plugins/AUDIT.md) records the two compose rules.
