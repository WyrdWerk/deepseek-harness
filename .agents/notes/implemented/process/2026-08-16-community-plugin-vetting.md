# Agent Note: Vet community plugins before composing

Status: implemented

English | [中文](2026-08-16-community-plugin-vetting.zh.md)

## Problem

A Tailscale-published coding agent that holds files, credentials, and git cannot install GitHub community plugins unvetted. Shai-Hulud-class npm worms ride `preinstall` on packages that looked legitimate the day before. A static look at one SHA is not a maintainer-identity or install-script guarantee, and `dsh plugin add` / a floating `github:` alias reintroduces whatever the next bump ships.

Rewriting every useful community plugin as first-party source is the other failure mode: it is too slow, and it throws away work from known maintainers whose provenance does hold up.

A 2026-08-16 audit of eight candidates found supply-chain and Host-fence gaps in that batch (missing provenance, install-lifecycle risk, and `dsh-chat-import` registering `/api-import/*` outside the `/api` Host fence). chat-import and compaction-instant stay off the live `dsh-web` process. That finding is about those plugins, not about the community plugin path.

## Decision

Community DSH plugins remain an install option. Before composing one into this fork, run a security audit: maintainer identity and provenance, install-lifecycle scripts, HTTP outside `/api`, and spawn/filesystem use against `ctx.subprocess` / `ctx.fs`. Record the audit with the compose change.

A plugin that passes may be composed (pinned, reviewed). A plugin that fails, or looks risky, is not a `file:` dependency, not a `dsh plugin add` target, and not a floating `github:` / `npm:` alias. If we still want the capability, read that repository as a design reference and rewrite a first-party workspace package under `packages/` on DSH seams: no HTTP outside `/api`, no install-lifecycle scripts, spawn only through `ctx.subprocess` argv, filesystem through `ctx.fs`, config in cordis.yml.

chat-import and compaction-instant stay out of `dsh-web-app`. tool-search, worktree, context, and session-notification passed a SHA-pinned re-audit and are composed as SHA-pinned workspace members ([pins](../../../../third-party/dsh-plugins/PINNED.md)). `@deepseek-ai/dsh-client-ui-sticky-disclosure` is the first first-party rewrite (behavior follows [dsh-sticky-disclosure](https://github.com/Han-1413141/dsh-sticky-disclosure), MIT; source is original TypeScript here). Shipped presets keep isolating `compaction-basic`. The apiproxy settings allowlist does not expose `compaction-instant`.

## Alternatives considered

**Blanket ban: community plugins are design references only, never runtime.** Rejected: well-known maintainers with a passing audit should still be usable; first-party rewrites of every plugin we might want take too long.

**Compose the eight audited plugins after that one SHA snapshot.** Rejected for this batch: provenance was missing or incomplete, and chat-import's unfenced HTTP is unacceptable on Tailscale Serve.

**`dsh plugin add` / home overlay without an audit.** Rejected: that is the supply-chain path, not a shortcut around it.

**Port chat-import with a Host fence.** Deferred: a 13k-line importer with twenty-one tools and outbound sync is a product. If import returns, it will be a small offline or `/api`-fenced allowlisted reader, not a port of that tree.

## Consequences

The community plugin path stays open behind an audit. chat-import and compaction-instant stay out of `dsh-web-app` until a later passing audit or a first-party rewrite. tool-search, worktree, context, and session-notification are composed at the pins in [PINNED.md](../../../../third-party/dsh-plugins/PINNED.md). sticky-disclosure is first-party. Translation pairing treats `third-party/` like `vendor/`: a discovery skip, not product bilingual source. Updating a failed community GitHub repo does not change this process; a passing audit PR or a rewrite PR does.
