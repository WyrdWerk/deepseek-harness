# `@deepseek-ai/dsh-advisor`

English

A turn-settled **advisor** for the agent loop: a second model reviews the session transcript against the operating constitution and injects silent-unless-material advisory notes. It adopts two proven mechanisms:

- **opencode's advisor profile** — the behavior constitution (source discipline, anti-hallucination with confidence labels, self-questioning, error correction) and the `NOTE | CONCERN | BLOCKER` advisory format with recommendations.
- **pi's advisor actor** — the directive posture: event-triggered on settled turns and tool errors, prefers silence, never steers every turn, read-only posture (no tools in v1).

## Mechanics

```
session/event turn/end ──► count turns ──► every cadenceTurns ─┐
session/event tool/result (error) ──► cooldown gate ───────────┤
                                                               ▼
                              buildDigest(session.deriveMessages(), budget)
                                        │  (skips the advisor's own notes)
                                        ▼
                     ctx.llm.stream({ provider, model, system: constitution })
                                        │  "SILENT" → inject nothing
                                        ▼
                          agent.inject([Advisor note — …])
                       (queues for the next step; never wakes the driver)
```

- Root sessions only (`delegationDepth === 0`) — subagents are not advised.
- At most one in-flight review per session; a review during a busy window is skipped, not queued.
- A failed reviewer call (missing provider, timeout) logs a warning and drops the cycle — it never disturbs the main agent.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch |
| `provider` | `openai` | Reviewer route (any mounted LLM route; point it at one your profile actually serves) |
| `model` | `gpt-4o-mini` | Reviewer model |
| `cadenceTurns` | `3` | Closed turns between scheduled reviews |
| `maxDigestChars` | `24000` | Transcript digest budget |
| `maxAdvisoryChars` | `2000` | Cap on one injected note |
| `wakeOnToolError` | `true` | Immediate review on tool errors |
| `toolErrorCooldownMs` | `300000` | Min gap between tool-error reviews |
| `timeoutMs` | `90000` | Per-review LLM timeout |
| `extraGuidance` | `""` | Deployment guidance appended to the constitution |

## Model Experience

The advisor is model-visible only through the notes it injects (`source: { kind: 'plugin', plugin: 'advisor' }`), which land as ordinary pre-step context. The constitution itself is reviewer-side text and never enters the main agent's prompt.

#### KV Cache effect

Negative by construction: each review is an independent one-shot request with no prefix reuse, and injected notes are short. Reviews cost one reviewer call per `cadenceTurns` turns.

## Known Limitations and Deferred Work

- **No reviewer tools in v1.** opencode's advisor could search the web/GitHub/memories mid-review; the DSH advisor reviews the digest only. Wiring `ctx.tools` execution (read-only allowlist) behind the reviewer is deferred.
- **No memory extraction.** `MEMORY:`-style durable extraction (opencode's MEMORY.md) is deferred; the memory-bridge MCP covers persistence today.
- **Review timing is turn-granular.** pi's actor could also wake on `session_compact`; that trigger is deferred.
