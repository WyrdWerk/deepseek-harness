# Audit: tool-search, worktree, context, session-notification

Date: 2026-08-16.
Policy: [.agents/notes/implemented/process/2026-08-16-community-plugin-vetting.md](../../.agents/notes/implemented/process/2026-08-16-community-plugin-vetting.md).
Pins: [PINNED.md](PINNED.md).

## Verdict

**Compose** these four as SHA-pinned workspace members of `dsh-web-app`. Do not `dsh plugin add` them and do not use a floating `github:` / `npm:` alias.

GitHub attestations 404 (no npm provenance). That is not an automatic fail: the trees live in this repository at a recorded SHA, `@deepseek-ai/*` versions are remapped onto this workspace, and a bump requires a new audit.

## Per plugin

### tool-search (`265ce76`)

- Maintainer: [vibeinging/dsh-tool-search](https://github.com/vibeinging/dsh-tool-search). Low star count; MIT.
- npm name `@deepseek-ai/dsh-tool-search` impersonates the official scope. **workspace pin only**, never the registry.
- No extra HTTP routes, no `fetch` to the public internet, no install-lifecycle downloaders.
- Runtime: `ctx.tools.restrict()` plus a scope-local `tool_search` tool. No spawn.
- Shipped `lib/` is present on the pin.
- Compose `tool-search` on the agent preset. Do **not** mount `tool-search-invariant` there: it injects host `invariants`, which `dsh-web` does not compose, and a waiting preset row fails the standing mount (`session.create` / workspace plus). The companion is a diagnostic for test compositions that include `@deepseek-ai/dsh-invariants`.

### worktree (`d61ce0f`)

- Maintainer: [FlashingChen/dsh-worktree](https://github.com/FlashingChen/dsh-worktree). MIT.
- Git via `ctx.subprocess.spawn({ argv: ["git", ...] })`. `child_process` appears only in `test/smoke.js`.
- Manifest I/O uses `node:fs` under `<repo>/.dsh-worktrees/`. Accepted: git worktree paths sit beside the repo, not on the sandboxed `ctx.fs` workspace face.
- inject: `tools`, `commands`, `subprocess`. Default `dirName`: `.dsh-worktrees`.
- `apply` calls `ctx.provide("worktree", manager)`. On an agent preset that must sit behind `isolate: { worktree: true }` or the standing mount fails `leakedServices`.
- No extra HTTP.

### context (`aca38b2`)

- Maintainer: [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context). Apache-2.0. Better-known than the other two (43 stars at audit).
- Host half registers a `sessionProjections` unit; client half is a conversation slot. Runtime dependency is `zod` only.
- No extra HTTP routes. `dsh.client.inject`: connection, locale, runtime, ui-conversation.
- Upstream `prepare: husky` is stripped before install (see PINNED.md).

### session-notification (`6bdd080`)

- Maintainer: [dingyi222666/dsh-session-notification](https://github.com/dingyi222666/dsh-session-notification). BSD-3-Clause in `package.json` (no LICENSE file in the repo). npm `@dingyi222666/dsh-session-notification@0.1.1` is `bd0fec6`; this pin is GitHub HEAD (docs-only lag).
- Host half registers the `dsh-session-notification` settings namespace. Browser half watches the sessions list, plays Web Audio (or a local custom file ≤ 1 MiB in localStorage), and optionally uses the Notification API. Prefs in localStorage.
- No extra HTTP routes, no `fetch`, no spawn, no `ctx.fs`. Nothing reaches a model request.
- Upstream `prepare: yarn run build` is stripped before install (see PINNED.md).
- A completed-session OS notification can include the last assistant message (product privacy, not a Host-fence gap).

## Still out

`chat-import` (unfenced `/api-import/*`) and `compaction-instant` stay out of `dsh-web-app`.
