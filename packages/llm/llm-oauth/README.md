# `@deepseek-ai/dsh-llm-oauth`

English

OAuth-only LLM provider routes for the Harness — **no API keys**. The plugin mounts pi-ai's OAuth-capable catalog providers on one `Models` collection built with a file-backed credential store, and registers one adapter per configured route. pi-ai refreshes stored tokens under the store lock whenever they go stale.

## Providers

| pi-ai provider | Route | Subscription | Catalog models |
|---|---|---|---|
| `openai-codex` | `codex` | ChatGPT Plus/Pro | `gpt-5.3-codex-spark`, `gpt-5.4`, `gpt-5.4-mini`, … |
| `xai` | `xai` | SuperGrok / X Premium | `grok-4.3`, `grok-4.5`, `grok-build-0.1`, … |

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
  providers:
    openai-codex:
      route: codex        # default
    xai:
      route: xai          # default
```

An empty `providers` map mounts both defaults. Per-entry fields (`route`, `displayName`, `storeKey`, `fallbackContextWindow`, `fallbackMaxTokens`) all default to the shipped values; only name what differs.

## Model Experience

Indirectly, through the routes it registers: the adapter contributes no model-visible text. Context conversion and stream translation are shared with `dsh-llm-pi-ai` (`toPiContext`, `toStreamChunks`), so reasoning deltas, tool-call fragments, and usage accounting behave identically on every pi-ai-backed adapter.

#### KV Cache effect

None directly; each provider's pi-ai implementation owns prompt caching on the wire.

## Known Limitations and Deferred Work

- **No first-party login flow.** The plugin consumes and refreshes existing stored credentials; initial login is owned by pi (`pi auth login`) or the Codex CLI. Wiring pi-ai's `*.login()` device-code flows behind a Harness command is deferred.
- **Per-process mutual exclusion only.** The store serializes writes in-process; a cross-process file lock is deferred because the sharing tools already serialize their own writes.
- **Unlisted model ids get conservative fallbacks** (per-entry context/output caps, text-only) until the catalog names them; the wire api is assumed from the provider's first catalog model.
- **A `codex-cli`-format store serves only `openai-codex`**; point `authPath` at pi's file to serve `xai` too.
