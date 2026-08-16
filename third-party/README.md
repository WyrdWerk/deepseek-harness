# third-party/

Clones here are for audit and, if they pass, SHA-pinned compose.

Do not compose a clone into `dsh-web-app` until a security audit passes (provenance, install-lifecycle scripts, HTTP outside `/api`, spawn/fs vs `ctx.subprocess` / `ctx.fs`).

A failed audit is not a `file:` dependency and not a Cordis row; rewrite first-party under `packages/` if we still want the capability.

Passing audits in this tree: [dsh-plugins/AUDIT.md](dsh-plugins/AUDIT.md).

See [.agents/notes/implemented/process/2026-08-16-community-plugin-vetting.md](../.agents/notes/implemented/process/2026-08-16-community-plugin-vetting.md).
