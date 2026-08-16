# LLM adapter plugin reference

Connect a new model provider by implementing `LlmAdapter` and registering it on `ctx.llm`. This reference is self-contained: it carries the protocol contract, the stream vocabulary, and the request fields you must honor. Reference implementations: `packages/llm/llm-deepseek` (direct HTTP, SSE framed by `eventsource-parser`) and `packages/llm/llm-pi-ai` (wrapping an LLM library); the `StreamChunk` doc in `packages/llm/llm/src/types.ts` records the protocol conventions both were verified against.

## The shape

```ts ignore-check
class MyAdapter extends LlmAdapter {
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> { … }
}

export const name = 'llm-myprovider'
export const inject = ['llm']
export const Config: z<Config> = z.object({ apiKey: z.string(), … })

export function apply(ctx: Context, config: Config) {
  ctx.llm.registerAdapter(['my-provider'], new MyAdapter(…))
}
```

Registration is effect-based and HMR-safe; one adapter per provider route — duplicates throw, and multi-route registration is all-or-nothing. `options.provider` selects the adapter and `options.model` is the provider model id, so a dynamic catalog adapter can serve new models without lifecycle reconfiguration. `registerAdapter()` returns a handle: the disposer, plus `replace(providers)` which atomically swaps the route set for the same adapter instance (an empty array is legal for replacement, never for initial registration; calling it after release throws). Secrets are cordis-native: schemastery Config with env fallbacks, fed from `cordis.yml` via `!!js process.env.MY_KEY`; never read ad-hoc key files in code.

## The stream vocabulary

Your `stream()` emits a closed union of chunks; a switch over `type` ends with `assertNever`, so a new variant breaks compilation at every consumer that must handle it:

```ts
type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }   // 'text' | 'reasoning' | 'image' | 'tool-call' | 'tool-result'
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: CallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: unknown }
```

`TokenUsage` counts are disjoint: `inputTokens` is uncached input only; cached input is reported separately as `cacheReadTokens`/`cacheWriteTokens` (billed input is the sum of the three); `reasoningTokens`, when present, is informational detail already included in `outputTokens` — totals must not add it again. Providers that fold cache hits into a single prompt total (DeepSeek's `prompt_tokens`) subtract them back out.

## The request you receive

`GenerateOptions` carries: `provider` (registered route selecting your adapter), `model` (provider model id), `reasoningEffort?` (adapter-owned effort id), `messages` (ordered conversation, exactly as the provider sees them after the system slot), `system?` (system prompt text), `tools?` (JSON-schema tool descriptions), `temperature?`, `maxTokens?`, `stop?` (stop sequences), `signal?` (AbortSignal — honor it), `sessionId?` (loop-stamped, for replay routing; adapters ignore it), and `purpose?` (`'compaction' | 'session-title'` for auxiliary calls). `BlockAssembler` in `packages/llm/llm/src/assembler.ts` folds a chunk stream back into blocks, usage, finish reason, and replay state — consumers use it instead of re-implementing the fold; your adapter does not assemble.

## Protocol obligations (the contract two implementations verified)

- Emit `usage` BEFORE `finish`; emit NOTHING after `finish`. Buffer finish and usage until the provider's end-of-stream marker, then flush, so a trailing usage-only chunk cannot violate ordering.
- Tool-call `arguments` stay RAW JSON strings end-to-end; stream fragments as `argumentsDelta`. If the provider hands back parsed objects, re-stringify at `block-end`.
- Allocate block `index`es in first-seen stream order; reuse the index for every delta of the same block.
- Errors have exactly two sanctioned paths: THROW from `stream()` for transport and protocol failures — use `LlmError` with a stable code — or end the stream with `finish { kind: 'error' | 'aborted', failure }` for provider in-band failures. Both normalize to one serializable `LlmFailure`: `message` (human-readable), `code` (stable provider-neutral machine-routing code), `status?` (HTTP status), `providerRetryAfterMs?` (validated positive delay requested by the provider, not a retry decision), `requestId?` (opaque branded provider-issued id for diagnostics). Consumers handle both paths; pick per failure class and document it. An empty completion is a retryable error, not a silent success: map a terminal `stop` finish that carried no content blocks to `finish { kind: 'error' }` with the canonical `EMPTY_RESPONSE` code.
- Honor `options.signal` (pass it to fetch or the SDK).
- A `GenerateOptions` field the provider cannot honor (e.g. a `stop` list on a provider without stop sequences): throw `LlmError(..., 'UNSUPPORTED')` rather than silently dropping it.
- If the provider needs response ids, signatures, or other native metadata on follow-up calls, emit the minimal lossless-JSON projection as `finish.replayState` and validate it when rebuilding history. `LlmService` passes it only when the historical provider route and target provider route are currently owned by the exact same adapter instance; your adapter decides whether same-model, cross-model, or cross-provider restoration is legal. Never infer native replay from provider/model names alone when state is absent.
- Context overflow has one canonical code: classify explicit provider detail through `isContextWindowExceededError()` and surface `CONTEXT_WINDOW_EXCEEDED`, whether the failure arrives as a thrown `LlmError` or an in-band finish error.
- Provider-specific thinking-mode toggles stay in the adapter's Config. Exact model metadata uses the provider-neutral capability seam: implement `resolveModel()` with provider/model identity plus optional `context` (provider-owned `contextWindow`) and `reasoning` (ordered `efforts`, optional `defaultEffort`), declare a configured `defaultEffort` only when one exists, and honor the resolver's optional `AbortSignal` — implementations must settle promptly after abort. Reasoning efforts are ordered opaque ids mapped to provider requests by the adapter; preserve the adapter's authoritative selectable list, including an adapter-defined `off` when supported, without exposing final wire spellings or clamping unsupported values.
- Every provider HTTP request carries the app-attribution header: send `attributionHeaders()` — the `User-Agent` baseline, `{ product, version, url }` sourced from the package manifest — and prove it with a wire-level test.
- One adapter call is one provider attempt: disable library retries. Agent-level recovery opens another durable numbered turn; direct `ctx.llm.stream()` callers remain single-attempt.
- Provider stalls are bounded at the transport: expose a positive finite `streamIdleTimeoutMs` (five-minute default in the shipping adapters), armed only while iterator `next()` is outstanding, using one stable signal for the whole request, mapping its own expiry to `TIMEOUT` and keeping an earlier caller abort as `ABORTED`.

## Implementation structure

Keep wire types, request serialization, transport parsing, chunk translation, and the adapter class as separate responsibilities; `llm-deepseek` is the reference layout. Optional surfaces: `providerRetryPolicy()` (immutable per-route policy; omitting it uses normal defaults), `providerInfo()` and asynchronous `listModels()` (advisory selector metadata — the catalog is never a request whitelist), and `registerConfigurableProviders()` to declare dormant routes a settings section can activate.

## Verification

Unit tests for chunk translation and error classification, a wire-level test proving `attributionHeaders()`, a real-API e2e with the provider key (suites self-skip without it) proving the adapter works against the live endpoint, the per-file 100% coverage gate, and a built-entry smoke when the package ships a runtime entry.
