# SHA pins

These trees are composed into `dsh-web-app` after the audit in [AUDIT.md](AUDIT.md). Bump a pin only with a new audit.

| Directory | Upstream | Pin | License |
|---|---|---|---|
| `tool-search/` | [vibeinging/dsh-tool-search](https://github.com/vibeinging/dsh-tool-search) | `265ce76eda21b211dc4a4c8f30d73a6826f035ca` | MIT |
| `worktree/` | [FlashingChen/dsh-worktree](https://github.com/FlashingChen/dsh-worktree) | `d61ce0f6c2498c94e996c63459c0dfb7c376c514` | MIT |
| `context/` | [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) | `aca38b24d714106f7256280dc8f9c9ec5b8e4552` | Apache-2.0 |
| `session-notification/` | [dingyi222666/dsh-session-notification](https://github.com/dingyi222666/dsh-session-notification) | `6bdd080f9e635495bcc35383933ad9aacc886618` | BSD-3-Clause |
| `agent-teams/` | [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | `9a743c3` | MIT |
| `genui/` | [omdsh-dev/dsh-genui](https://github.com/omdsh-dev/dsh-genui) | `2187fa4` | MIT |

Do not resolve `@deepseek-ai/dsh-tool-search` from npm. That name impersonates the official scope; this tree is a workspace pin only.

Do not `dsh plugin add @dingyi222666/dsh-session-notification`. That is a floating registry alias; this tree is the pin.

## Local modifications on top of the pins

- Map every `@deepseek-ai/*` production, peer, and remaining dev dependency to `workspace:^`. The trees are pnpm workspace members so install cannot fetch official registry tarballs.
- Remove `dsh.bundle.patch` from tool-search, context, and session-notification so `dsh plugin add` cannot double-mount beside the explicit Cordis rows.
- Remove context `scripts.prepare` (`husky`) and the `husky` devDependency.
- Remove session-notification `scripts.prepare` (`yarn run build`). Runtime `lib/` is produced with `tsdown` in this workspace (the pin's `tsc` paths point at the author's private checkout and are not used).
- Stop ignoring `lib/` in context's, session-notification's, and agent-teams' `.gitignore` so the shipped host/client bundles can be committed.
- Drop worktree's `package-lock.json` (it targeted npm `4.0.1` / `0.1.0` ranges).
- Drop session-notification's `.yarn/` store and `yarn.lock` (this workspace uses pnpm).
- Nested `.git` directories are not kept; the SHA above is the source of record.
- Trim trailing whitespace in context `AGENTS.md` so `git diff --cached --check` passes.
- Map agent-teams and genui `@deepseek-ai/*` production and peer dependencies to `workspace:^` the same way as the first four pins.
- Build agent-teams in this workspace (`tsdown`); upstream ships no prebuilt `lib/`.
- Genui ships a prebuilt `lib/` (including vendored mermaid/three assets); keep that tree, do not rebuild from a floating registry tarball.
- The complete workbench inventory, including profile-only plugins that are not in this directory, lives in [FORK.md](../../FORK.md).
