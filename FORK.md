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
| (this commit) | **Fork guard CI + this document** — `.github/workflows/fork-guard.yml` secret-scans every push with pinned gitleaks + `.gitleaks.toml` allowlist; FORK.md records the divergence; README carries a fork banner; `dsh-llm-oauth` README documents dynamic catalogs. |

## Working conventions

- **Update this file in the same commit** that adds or changes fork-local
  behavior. A change that is not listed here is a bug in the process.
- **Secrets never enter the repository.** Credentials live in
  `~/.pi/agent/auth.json` (0600) or `$DSH_HOME/.credentials.yaml`; repo
  config carries only paths and references (`authPath`, `apiKeyEnv`,
  `storeKey`). The gitleaks guard enforces this on every push.
- **The staging mirror** (`~/Agent/Agent/dsh-plugins` on the dev machine)
  holds source-of-truth copies of the fork-local packages and the
  `install.sh` re-apply script; keep it in sync when packages change.
- **Merging upstream:** rebase local commits onto upstream `master`, re-run
  `pnpm install && pnpm run build:lib:host`, resolve the translation-pairing
  records (`pnpm run doc-sync`), and re-verify the table above.
