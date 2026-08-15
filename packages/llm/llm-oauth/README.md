# `@deepseek-ai/dsh-llm-oauth`

English

OAuth-only LLM provider routes for the Harness — **no API keys**. The plugin mounts pi-ai's OAuth-capable catalog providers on one `Models` collection built with a file-backed credential store, and registers one adapter per configured route. pi-ai refreshes stored tokens under the store lock whenever they go stale.

> Fork-local package (WyrdWerk). See the repository root [FORK.md](../../../FORK.md) for how this fork diverges from upstream.

## Providers

| pi-ai provider | Route | Subscription | Catalog models (static baseline) |
|---|---|---|---|
| `openai-codex` | `codex` | ChatGPT Plus/Pro | `gpt-5.3-codex-spark`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.5`, `gpt-5.6-luna/sol/terra` |
| `xai` | `xai` | SuperGrok / X Premium | `grok-4.3`, `grok-4.5`, `grok-build-0.1` |

## Dynamic model catalogs

The static table above is only the **baseline**. With `dynamicModels` (default on), each provider is rebuilt with a `fetchModels` overlay that lists its own endpoint over the freshly refreshed OAuth credential, so new model generations appear without a plugin upgrade:

- **openai-codex** — `GET https://chatgpt.com/backend-api/codex/models?client_version=<v>` (Bearer + `chatgpt-account-id` + `originator` headers). Entries that are hidden (`visibility ≠ list`), unsupported by the API, or newer than `client_version` are filtered; reasoning efforts map onto pi-ai's `thinkingLevelMap` (`ultra` clamps to `max`, `minimal` rides the wire as `low`).
- **xai** — `GET https://api.x.ai/v1/models`. `context_length` becomes the context window; image pricing marks image input. Live-verified: lists the `grok-4.20` series and `grok-4.6`.

Results cache in `${HOME}/.cache/dsh/llm-oauth-models.json` (atomic write, 0600, **models + ETag + timestamps only — never credentials**) and `Models.refresh()` re-lists on mount and every `refreshIntervalMs` (default 6h), refreshing the OAuth credential first so a stale token never blocks a catalog update.

## Why a separate adapter

`dsh-llm-pi-ai` resolves every credential through its api-key seam and holds no OAuth store, so pi-ai's OAuth-only providers are explicitly out of scope there. This plugin owns exactly that gap: OAuth credential resolution, refresh, and persistence, delegated to pi-ai's `Models` layer running token refresh under the store's `modify` lock.

## Credential store

| Format | Path | Notes |
|---|---|---|
| `pi` | `~/.pi/agent/auth.json` | Default first choice; pi keeps it refreshed |
| `codex-cli` | `~/.codex/auth.json` | Fallback; read and written in its own shape |

`authPath` pins a store explicitly. In pi's file, providers are keyed by login-flow name — `xai` lives under `xai-oauth` — and that mapping is built in (overridable per entry via `storeKey`). A `codex-cli` file without `expires_at` reports unknown expiry, forcing exactly one refresh before the first request. Writes are atomic (tmp + rename, mode 0600) and serialized per provider.

## Configuration

```yaml
llm-oauth:
  authPath: ''            # auto-detect (pi then Codex CLI)
  streamIdleTimeoutMs: 300000
  dynamicModels: true     # listing-endpoint catalogs, cached + refreshed
  clientVersion: 0.147.0  # codex CLI version to claim when listing
  modelsCachePath: ''     # default ~/.cache/dsh/llm-oauth-models.json
  refreshIntervalMs: 21600000
  providers:              # empty mounts both defaults below
    openai-codex:
      route: codex
    xai:
      route: xai
```

Per-entry fields (`route`, `displayName`, `storeKey`, `fallbackContextWindow`, `fallbackMaxTokens`) all default to the shipped values; only name what differs.

## Model Experience

Indirectly, through the routes it registers: the adapter contributes no model-visible text. Context conversion and stream translation are shared with `dsh-llm-pi-ai` (`toPiContext`, `toStreamChunks`), so reasoning deltas, tool-call fragments, and usage accounting behave identically on every pi-ai-backed adapter.

#### KV Cache effect

None directly; each provider's pi-ai implementation owns prompt caching on the wire. Catalog refreshes are cheap conditional requests when the ETag still matches.

## Known Limitations and Deferred Work

- **No first-party login flow.** The plugin consumes and refreshes existing stored credentials; initial login is owned by pi (`pi auth login`) or the Codex CLI. Wiring pi-ai's device-code `*.login()` flows behind a Harness command is deferred.
- **Per-process mutual exclusion only.** The store serializes writes in-process; a cross-process file lock is deferred because the sharing tools already serialize their own writes.
- **`clientVersion` is a config knob, not auto-detected** — bump it when OpenAI gates newer models behind a newer claimed CLI version.
- **Unlisted model ids get conservative fallbacks** (per-entry caps, text-only; wire api assumed from the provider's first catalog model) — relevant only when `dynamicModels: false`.
- **A `codex-cli`-format store serves only `openai-codex`**; point `authPath` at pi's file to serve `xai` too.
