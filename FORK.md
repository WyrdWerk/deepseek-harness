# About this fork

This repository is the **WyrdWerk fork** of
[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness),
maintained as a private customer gateway build. It tracks upstream `master`
and carries a small, documented set of local changes on top.

**Every commit that diverges from upstream must update this file.** The list
below is the complete, authoritative record of the divergence.

## Changes carried by this fork

| Commit | Change |
|---|---|
| `706daad` | **Strip the official DeepSeek adapters and the OTel telemetry backend** so the harness runs as a private customer gateway: removes `dsh-llm-deepseek` wiring, the OTel backend, telemetry-switch tests, the DeepSeek onboarding fixtures, and the web-search e2e round. |
| `1572d13` | **Publish the web app through `tailscale serve`** — `web-app` gains a `tailscaleServe` option that publishes the bound loopback port after listen; MagicDNS discovery in `web-startup`; new `tailscale-trust` module with tests; cookbook page and agent notes. |
| `83c5392` | **OAuth LLM provider routes + advisor plugin** — new `@deepseek-ai/dsh-llm-oauth` (ChatGPT-subscription Codex on route `codex`, Grok/X-subscription xAI on route `xai`; file-backed credential store sharing pi's `~/.pi/agent/auth.json` or the Codex CLI's; pi-ai refreshes tokens under the store lock) and `@deepseek-ai/dsh-advisor` (turn-settled advisory reviewer injecting silent-unless-material notes via `agent.inject()`). Both rows mount in `dsh-base`. |
| `5df8e7a` | **Dynamic model catalogs** — each OAuth provider is rebuilt with a `fetchModels` overlay listing its own endpoint (`/backend-api/codex/models`, `/v1/models`), cached in `~/.cache/dsh/llm-oauth-models.json`, refreshed on mount and every 6h; new model generations appear without a plugin upgrade. |
| `80c8f7c` | **Fork guard CI + fork documentation** — `.github/workflows/fork-guard.yml` secret-scans every push with pinned gitleaks; `FORK.md` records the divergence; README carries a fork banner; `dsh-llm-oauth` README documents dynamic catalogs. |
| `5eb852c` | **Scope fork-guard to fork commits only** — the scan covers `47f9438..HEAD` (only commits made in this fork), never upstream history; the upstream-fixture allowlists are gone with it. Upstream's 6k-commit history is out of scope by policy: audited once (2026-08-15) with zero real credentials found, and re-audited only if the fork rebases. |
| `c95ad94` | **Harden the guard** — pin the real fork-point SHA and add a CI step that resolves `FORK_POINT` and fails on an empty commit range, so an invalid pin can never again produce a vacuous green scan. |
| `245c0eb` | **Drop the real-API e2e workflow** - it tests the official DeepSeek adapters this fork removed and its preflight hard-fails without a DEEPSEEK_API_KEY repo secret, so it has failed on every push since 706daad. Removed rather than silenced; restore it (plus the secret and adapters) if upstream e2e coverage is ever wanted back. |
| `0dfa6b3` | **Drop the macOS Seatbelt sandbox leg** - the fork is Linux-only by policy; upstream's Sandbox matrix included a macos-latest/seatbelt leg whose darwin-parity failures on this fork were noise, not signal. Linux legs (bwrap, Landlock x2 arch) remain the full sandbox proof surface. |
| `ceeddd8` | **Privileged /api methods honor declared serving authorities** - upstream pins the privileged set (settings/credentials plane, dialogs, presets, llm.discoverModels) to loopback with an empty trust list, which made the tailscale-serve GUI unable to load its Models page over the MagicDNS URL it itself prints. Privileged methods now pass the deployment trust list; the Host fence, same-Origin check, and cross-site refusal are unchanged. |
| df7017b909 | **Complete the privileged-fence test inversion** - the real-HTTP variant test still asserted the loopback pin; rewritten to the fork policy (declared authority passes, undeclared still 403). |
| `e6104c8` | **Omit assembled `assistant/chunk` events from `session.history`** — a 50-message page no longer ships the completed token tape (measured 16 MiB / 84k chunks on an attached GLM session); in-flight and interrupted steps keep chunks. Durable logs, mux, and export are unchanged. |
| `e939f72` | **Retire in-tree `dsh-llm-oauth`.** Official DeepSeek Harness did not add Codex/Grok OAuth packages (it has Codex as a *subagent* backend). ChatGPT OAuth is community [`dsh-codex`](https://github.com/Yan-Zero/dsh-codex) `0.2.3`; Grok is fork-local `dsh-grok`. Both are web-profile bundles (`dsh plugin --profile web add`), not `dsh-web-app` rows: they register `/plugins/*/auth/*` outside the `/api` Host fence (loopback-trusted). Credentials are `$DSH_HOME/.openai-codex-auth.json` and `$DSH_HOME/.grok-auth.json`. Advisor's shipped default is `openai`/`gpt-4o-mini`. |
| `e939f72` | **Vet community plugins before composing** — community plugins stay an install option after a security audit (provenance, install scripts, Host fence). SHA-pinned compose for tool-search, worktree, context, and session-notification; chat-import and compaction-instant stay out. First-party `@deepseek-ai/dsh-client-ui-sticky-disclosure` rewrites sticky headers. Failed audits are design references, not a blanket ban. Preset rows: omit `tool-search-invariant` (waits for host `invariants`); isolate worktree's `worktree` service. |

## Working conventions

- **Update this file in the same commit** that adds or changes fork-local
  behavior. A change that is listed here is the contract; a change that is
  not listed is a bug in the process.
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
