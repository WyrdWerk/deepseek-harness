# third-party/

Clones here are for audit and, if they pass, SHA-pinned compose.

Do not compose a clone into `dsh-web-app` until a security audit passes (provenance, install-lifecycle scripts, HTTP outside `/api`, spawn/fs vs `ctx.subprocess` / `ctx.fs`).

A failed audit is not a `file:` dependency and not a Cordis row; rewrite first-party under `packages/` if we still want the capability.

Passing audits in this tree (all composed into `dsh-web-app`):

- [vibeinging/dsh-tool-search](https://github.com/vibeinging/dsh-tool-search)
- [FlashingChen/dsh-worktree](https://github.com/FlashingChen/dsh-worktree)
- [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context)
- [dingyi222666/dsh-session-notification](https://github.com/dingyi222666/dsh-session-notification)
- [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams)
- [omdsh-dev/dsh-genui](https://github.com/omdsh-dev/dsh-genui)

Pins and local modifications: [dsh-plugins/PINNED.md](dsh-plugins/PINNED.md).
Audits: [dsh-plugins/AUDIT.md](dsh-plugins/AUDIT.md).
The complete workbench inventory (including profile-only plugins that are *not* in this tree) lives in [FORK.md](../FORK.md).

See [.agents/notes/implemented/process/2026-08-16-community-plugin-vetting.md](../.agents/notes/implemented/process/2026-08-16-community-plugin-vetting.md).
