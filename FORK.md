# About this fork

This repository is the **WyrdWerk fork** of
[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness),
maintained as a private customer gateway build. It tracks upstream `master`
and carries a small, documented set of local changes on top.

**Every commit that diverges from upstream must update this file.** The commit
table below is the complete changelog of the divergence. The inventories
below the table are the complete current-state record of plugins, install
sources, and community work this fork adopted or used as a design reference.

A change that is listed here is the contract; a change that is not listed is
a bug in the process.

## How to read this file

| Section | Job |
|---|---|
| [Current workbench](#current-workbench) | What actually runs: two profiles, three install shelves, every plugin with its upstream link and install method |
| [Plugin inventory](#plugin-inventory) | One row per plugin, including failed audits and design-only references |
| [Adopted learnings](#adopted-learnings) | Community work we took as behavior or design without composing the original tree |
| [Changes carried by this fork](#changes-carried-by-this-fork) | One row per fork commit |
| [Working conventions](#working-conventions) | How to add the next change |

Machine-local secrets, model URLs, and API keys never belong here. They live
in `$DSH_HOME` (`/home/yash/Agent/.dsh` on this host). This file names
paths, package names, and public upstream links only.

## Current workbench

DeepSeek Harness runs as a private AI workbench behind Tailscale. Two
profiles share this checkout and the same `$DSH_HOME`:

| Profile | Port | What it is |
|---|---|---|
| `web` | 28950 | Daily GUI |

A **profile** is a named install of the harness: its own `package.json`
bundle list under `$DSH_HOME/profiles/<name>/`, then the shared home overlay
`$DSH_HOME/cordis.patch.yml`. Think of three shelves, not one plugins folder.

### Shelf 1 — baked into this checkout

After a written security audit, the tree is copied into
[`third-party/dsh-plugins/`](third-party/dsh-plugins/PINNED.md) and wired
into `dsh-web-app`. Both profiles get these automatically. Do not
`dsh plugin add` them.

### Shelf 2 — installed only on this machine

These are **not** in the git checkout. A clone does not get them until the
operator installs them onto a profile. They live in
`$DSH_HOME/profiles/<name>/package.json` as `dsh.profile.bundles`.

### Shelf 3 — this machine's overlay

`$DSH_HOME/cordis.patch.yml` picks default models and extra tools for *this*
host. It is not part of the fork and must not be copied into the repo.
Credentials stay in `$DSH_HOME/.credentials.yaml`,
`$DSH_HOME/.openai-codex-auth.json`, and `$DSH_HOME/.grok-auth.json`.

The staging mirror `~/Agent/Agent/dsh-plugins` holds source-of-truth copies
of fork-local profile packages, the retired-advisor rollback archive, CI
files, and `install.sh`.

## Plugin inventory

Every extra capability this workbench runs or considered. "In checkout"
means a git path in this repository. "Profile only" means
`dsh plugin --profile <name> add` (or a `link:` to the staging mirror).

### Composed into `dsh-web-app` (shelf 1)

| Plugin | What it does | Upstream | How it is installed | Pin / version |
|---|---|---|---|---|
| tool-search | Lets the agent look up extra tools instead of loading every tool at once | [vibeinging/dsh-tool-search](https://github.com/vibeinging/dsh-tool-search) | SHA-pinned workspace member `third-party/dsh-plugins/tool-search/`; preset row on `standard` / `code` / `cordis`. **Never** install from npm: the package name impersonates `@deepseek-ai/` | `265ce76eda21b211dc4a4c8f30d73a6826f035ca` |
| worktree | Separate git work folders for parallel work (`/worktree`) | [FlashingChen/dsh-worktree](https://github.com/FlashingChen/dsh-worktree) | SHA-pinned `third-party/dsh-plugins/worktree/`; preset row with `isolate: { worktree: true }` | `d61ce0f6c2498c94e996c63459c0dfb7c376c514` |
| context | Extra context panel in the chat UI | [bowenliang123/dsh-context](https://github.com/bowenliang123/dsh-context) | SHA-pinned `third-party/dsh-plugins/context/`; host row `dsh-context` in `dsh-web-app` | `aca38b24d714106f7256280dc8f9c9ec5b8e4552` |
| session-notification | Sounds and optional desktop pings when a session finishes | [dingyi222666/dsh-session-notification](https://github.com/dingyi222666/dsh-session-notification) | SHA-pinned `third-party/dsh-plugins/session-notification/`; host row in `dsh-web-app`. Do not `dsh plugin add` the npm alias | `6bdd080f9e635495bcc35383933ad9aacc886618` |
| AgentTeams | Multi-agent teams the model can drive in natural language, with a tree monitor in the GUI | [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | SHA-pinned `third-party/dsh-plugins/agent-teams/`; host row `agent-teams` (`dsh-agent-teams`) in `dsh-web-app` | `9a743c3` (`dsh-agent-teams@0.1.5`) |
| GenUI | Visual cards, charts, and forms in chat via a ```dsh-ui fence | [omdsh-dev/dsh-genui](https://github.com/omdsh-dev/dsh-genui) | SHA-pinned `third-party/dsh-plugins/genui/`; host row `genui` in `dsh-web-app` | `2187fa4` (`@omdsh-dev/dsh-genui@0.8.6`) |
| sticky-disclosure | Pins Think/tool headers that have scrolled off the top, plus collapse-all | First-party `packages/client/ui-sticky-disclosure/`. Behavior follows [Han-1413141/dsh-sticky-disclosure](https://github.com/Han-1413141/dsh-sticky-disclosure) (MIT); source here is original TypeScript, not a vendored copy | Host row `ui-sticky-disclosure` in `dsh-web-app` | in-tree |

Audits and the pin table: [AUDIT.md](third-party/dsh-plugins/AUDIT.md),
[PINNED.md](third-party/dsh-plugins/PINNED.md). Policy:
[community-plugin-vetting](.agents/notes/implemented/process/2026-08-16-community-plugin-vetting.md).

Preset compose rules that belong with those pins: omit `tool-search-invariant`
(it waits for host `invariants`, which `dsh-web` does not compose);
isolate worktree's `worktree` service. Both are required or workspace-plus
(`session.create`) fails.

### Profile-only (shelf 2)

| Plugin | What it does | Upstream / source | How it is installed | Profiles |
|---|---|---|---|---|
| `dsh-codex` | ChatGPT / Codex subscription login and models | [Yan-Zero/dsh-codex](https://github.com/Yan-Zero/dsh-codex) on npm | `dsh plugin --profile <name> add dsh-codex` → `dsh-codex@0.2.3`. Credentials: `$DSH_HOME/.openai-codex-auth.json`. Routes `/plugins/*/auth/*` stay loopback-trusted (not composed into `dsh-web-app` for that reason) | `web` |
| `dsh-grok` | SuperGrok / X Premium login and xAI models | Fork-local package in the staging mirror (no public npm). Device-code login against xAI | `dsh plugin --profile <name> add link:~/Agent/Agent/dsh-plugins/dsh-grok`. Credentials: `$DSH_HOME/.grok-auth.json` | `web` |
| `dsh-advisor` | Turn-settled reviewer: after a few turns it may inject a silent note if something material is off | [omdsh-dev/dsh-advisor](https://github.com/omdsh-dev/dsh-advisor) on npm ([npmjs.com/package/dsh-advisor](https://www.npmjs.com/package/dsh-advisor)) | `dsh plugin --profile <name> add dsh-advisor` → `dsh-advisor@0.2.0`. Plugin defaults **disabled**; the home overlay sets `enabled: true` plus provider/model. Loader id is `advisor` — it cannot coexist with the retired in-tree package | `web` |
| `dsh-roster-manager` | Settings UI for editing `$DSH_HOME/agent-rosters.md` (per-agent model and persona) | Fork-local package in the staging mirror | `dsh plugin --profile web add link:~/Agent/Agent/dsh-plugins/dsh-roster-manager` | `web` only |


### Still out (audited or reviewed, not composed)

| Plugin | Upstream | Why it is out | What we kept |
|---|---|---|---|
| chat-import | community `dsh-chat-import` | Unfenced `/api-import/*` outside the `/api` Host fence | Design reference only. If import returns, it will be a small offline or `/api`-fenced reader, not a port of that tree |
| compaction-instant | community compaction plugin | Not on the live `dsh-web` process; shipped presets keep isolating `compaction-basic`; the apiproxy settings allowlist does not expose it | Design reference only |
| DSH-better-sidebar | [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) | Reviewed under `~/Agent/Agent/plugin-review/DSH-better-sidebar`; not composed (large extra HTTP/PTY surface) | Design reference for a session-local explorer / editor / terminal sidebar |
| dsh-web-ui skins | community skin gallery reviewed under `~/Agent/Agent/plugin-review/dsh-web-ui` | Not composed | Design reference for official-facade skins; this fork does not ship a skin pack |

A failed or skipped audit is not a `file:` dependency, not a Cordis row, and
not a floating `github:` / `npm:` alias.

## Adopted learnings

Community work this fork took as *behavior or design*, even when the original
tree is not what runs.

| Source | What we took | What actually runs |
|---|---|---|
| [Han-1413141/dsh-sticky-disclosure](https://github.com/Han-1413141/dsh-sticky-disclosure) (MIT) | Pin off-screen Think/tool headers, collapse-all, local hotkey | First-party `@deepseek-ai/dsh-client-ui-sticky-disclosure` — original TypeScript on DSH client seams; no extra HTTP |
| [Yan-Zero/dsh-codex](https://github.com/Yan-Zero/dsh-codex) | Provider-owned ChatGPT login and credential file, instead of borrowing `~/.codex/auth.json` | Profile plugin `dsh-codex@0.2.3`. In-tree `dsh-llm-oauth` is gone |
| Fork-local `dsh-grok` (same lesson as Codex) | Provider-owned xAI device-code login and `$DSH_HOME/.grok-auth.json` | Profile plugin from the staging mirror |
| [omdsh-dev/dsh-advisor](https://github.com/omdsh-dev/dsh-advisor) | Turn-settled reviewer as an installable plugin with OIDC-provenance releases | Profile plugin `dsh-advisor@0.2.0`. In-tree `packages/core/advisor` is gone (duplicate loader id `advisor`) |
| [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) | Natural-language multi-agent teams + GUI tree | SHA-pinned compose, not `dsh plugin add` |
| [omdsh-dev/dsh-genui](https://github.com/omdsh-dev/dsh-genui) | Whitelisted inline UI fence (```dsh-ui) | SHA-pinned compose, not `dsh plugin add` |
| chat-import, compaction-instant, better-sidebar, dsh-web-ui | What *not* to compose on a Tailscale-published agent: unfenced HTTP, install-lifecycle scripts, floating registry aliases | Policy in the vetting Agent Note; those trees stay under `~/Agent/Agent/plugin-review/` as references |

## Changes carried by this fork

| Commit | Change |
|---|---|
| `706daad` | **Strip the official DeepSeek adapters and the OTel telemetry backend** so the harness runs as a private customer gateway: removes `dsh-llm-deepseek` wiring, the OTel backend, telemetry-switch tests, the DeepSeek onboarding fixtures, and the web-search e2e round. |
| `1572d13` | **Publish the web app through `tailscale serve`** — `web-app` gains a `tailscaleServe` option that publishes the bound loopback port after listen; MagicDNS discovery in `web-startup`; new `tailscale-trust` module with tests; cookbook page and agent notes. |
| `83c5392` | **OAuth LLM provider routes + advisor plugin** — new `@deepseek-ai/dsh-llm-oauth` (ChatGPT-subscription Codex on route `codex`, Grok/X-subscription xAI on route `xai`; file-backed credential store sharing pi's `~/.pi/agent/auth.json` or the Codex CLI's; pi-ai refreshes tokens under the store lock) and `@deepseek-ai/dsh-advisor` (turn-settled advisory reviewer injecting silent-unless-material notes via `agent.inject()`). Both rows mount in `dsh-base`. **Superseded** by `e939f72` (OAuth leaves the checkout) and the advisor-retirement row below. |
| `5df8e7a` | **Dynamic model catalogs** — each OAuth provider is rebuilt with a `fetchModels` overlay listing its own endpoint (`/backend-api/codex/models`, `/v1/models`), cached in `~/.cache/dsh/llm-oauth-models.json`, refreshed on mount and every 6h; new model generations appear without a plugin upgrade. **Superseded** for Codex/Grok by the profile plugins (`dsh-codex`, `dsh-grok`), which own their own listing caches. |
| `80c8f7c` | **Fork guard CI + fork documentation** — `.github/workflows/fork-guard.yml` secret-scans every push with pinned gitleaks; `FORK.md` records the divergence; README carries a fork banner; `dsh-llm-oauth` README documents dynamic catalogs. |
| `5eb852c` | **Scope fork-guard to fork commits only** — the scan covers `47f9438..HEAD` (only commits made in this fork), never upstream history; the upstream-fixture allowlists are gone with it. Upstream's 6k-commit history is out of scope by policy: audited once (2026-08-15) with zero real credentials found, and re-audited only if the fork rebases. |
| `c95ad94` | **Harden the guard** — pin the real fork-point SHA and add a CI step that resolves `FORK_POINT` and fails on an empty commit range, so an invalid pin can never again produce a vacuous green scan. |
| `245c0eb` | **Drop the real-API e2e workflow** — it tests the official DeepSeek adapters this fork removed and its preflight hard-fails without a DEEPSEEK_API_KEY repo secret, so it has failed on every push since 706daad. Removed rather than silenced; restore it (plus the secret and adapters) if upstream e2e coverage is ever wanted back. |
| `0dfa6b3` | **Drop the macOS Seatbelt sandbox leg** — the fork is Linux-only by policy; upstream's Sandbox matrix included a macos-latest/seatbelt leg whose darwin-parity failures on this fork were noise, not signal. Linux legs (bwrap, Landlock x2 arch) remain the full sandbox proof surface. |
| `ceeddd8` | **Privileged /api methods honor declared serving authorities** — upstream pins the privileged set (settings/credentials plane, dialogs, presets, llm.discoverModels) to loopback with an empty trust list, which made the tailscale-serve GUI unable to load its Models page over the MagicDNS URL it itself prints. Privileged methods now pass the deployment trust list; the Host fence, same-Origin check, and cross-site refusal are unchanged. |
| `df7017b909` | **Complete the privileged-fence test inversion** — the real-HTTP variant test still asserted the loopback pin; rewritten to the fork policy (declared authority passes, undeclared still 403). |
| `e6104c8` | **Omit assembled `assistant/chunk` events from `session.history`** — a 50-message page no longer ships the completed token tape (measured 16 MiB / 84k chunks on an attached GLM session); in-flight and interrupted steps keep chunks. Durable logs, mux, and export are unchanged. |
| `e939f72` | **Retire in-tree `dsh-llm-oauth`.** Official DeepSeek Harness did not add Codex/Grok OAuth packages (it has Codex as a *subagent* backend). ChatGPT OAuth is community [`dsh-codex`](https://github.com/Yan-Zero/dsh-codex) `0.2.3`; Grok is fork-local `dsh-grok`. Both are web-profile bundles (`dsh plugin --profile web add`), not `dsh-web-app` rows: they register `/plugins/*/auth/*` outside the `/api` Host fence (loopback-trusted). Credentials are `$DSH_HOME/.openai-codex-auth.json` and `$DSH_HOME/.grok-auth.json`. |
| `e939f72` | **Vet community plugins before composing** — community plugins stay an install option after a security audit (provenance, install scripts, Host fence). SHA-pinned compose for tool-search, worktree, context, and session-notification; chat-import and compaction-instant stay out. First-party `@deepseek-ai/dsh-client-ui-sticky-disclosure` rewrites sticky headers. Failed audits are design references, not a blanket ban. Preset rows: omit `tool-search-invariant` (waits for host `invariants`); isolate worktree's `worktree` service. |
| `5254cf5` | **Retire the fork-local advisor for the upstream `dsh-advisor` plugin** — `packages/core/advisor` is removed with its base-bundle row, dependency, and tsconfig reference. The fork row and the plugin bundle share loader entry id `advisor`, and the loader rejects duplicate ids at boot (proven by a canary profile before any production change), so they cannot coexist. The reviewer role moves to the per-profile `dsh-advisor@0.2.0` npm plugin (audited 2026-08-16: zero network/exec/telemetry in source and shipped lib, tarball byte-identical to a from-source build, OIDC trusted publishing with SLSA provenance, 360 tests; its `/api/advisor/set` gateway sits behind the fork's `isTrustedApiRequest` fence — declared serving authorities only). The staging mirror keeps the old package as the rollback archive and `install.sh` now strips rather than stages it. The home-layer `advisor` row carries `provider`/`model` over unchanged; `enabled: true` is added there because the plugin defaults disabled. |
| `5254cf5` | **SHA-pin AgentTeams and GenUI** into `dsh-web-app` after the 2026-08-17 audit: [NanmiCoder/dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) `9a743c3` and [omdsh-dev/dsh-genui](https://github.com/omdsh-dev/dsh-genui) `2187fa4`. Workspace members, remapped `@deepseek-ai/*` → `workspace:^`, explicit Cordis rows, not `dsh plugin add`. |

## Working conventions

- **Update this file in the same commit** that adds or changes fork-local
  behavior. Replace each ``5254cf5`` cell with the commit SHA when that
  change lands. A change that is listed here is the contract; a change that is
  not listed is a bug in the process.
- **New community plugin:** audit first (provenance, install-lifecycle
  scripts, HTTP outside `/api`, spawn/fs vs `ctx.subprocess` / `ctx.fs`).
  Passing → SHA-pin under `third-party/dsh-plugins/` and a row here plus
  [AUDIT.md](third-party/dsh-plugins/AUDIT.md) / [PINNED.md](third-party/dsh-plugins/PINNED.md).
  Failing → design reference only, listed under [Still out](#still-out-audited-or-reviewed-not-composed).
- **New profile plugin** (Host-fence exception, login UI, or lab-only):
  install with `dsh plugin --profile <name> add` or a staging `link:`, and
  add a row to [Profile-only](#profile-only-shelf-2) in the same documentation
  change. Do not sneak it into `dsh-web-app`.
- **Secrets never enter the repository.** Credentials live in
  `$DSH_HOME/.credentials.yaml`, `$DSH_HOME/.openai-codex-auth.json`,
  `$DSH_HOME/.grok-auth.json`, or `~/.pi/agent/auth.json` (0600). Repo
  config carries only paths and references (`authPath`, `apiKeyEnv`,
  `storeKey`). The fork-guard workflow enforces this on every push, over
  the fork's own commits (`47f9438..HEAD`).
- **Rebasing upstream:** update `FORK_POINT` in `.github/workflows/fork-guard.yml`
  to the new merge-base in the same commit, re-run `pnpm install && pnpm run
  build:lib:host`, resolve the translation-pairing records (`pnpm run
  doc-sync`), and update the table above.
- **The staging mirror** (`~/Agent/Agent/dsh-plugins` on the dev machine)
  holds source-of-truth copies of the fork-local packages, CI files, and the
  `install.sh` re-apply script; keep it in sync when packages change.
