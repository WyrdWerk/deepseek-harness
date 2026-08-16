# Hook plugin reference

A hook plugin intercepts a documented extension point without changing the loop: permission gates, sandbox or plan-mode policy, deadlines, retries, metrics, telemetry, request routing. A "native hook" is an ordinary Cordis plugin on an interception point; it needs no external protocol. This reference is self-contained: it carries the interception semantics, the extension-point map, and the typed-decision template.

## Waterfall semantics

`ctx.waterfall` is around-middleware. A listener receives `(...args, next)`; call `next()` to delegate the possibly wrapped result to the next service, and return without `next()` to short-circuit. Values propagate through `next()`'s return value. Cooperative listeners usually mutate a shared request or decision object and then delegate; a listener can also replace the result entirely, and downstream listeners only see the result after replacement. Use `prepend: true` only when the listener must run before ordinary registrations. For single-decision events, short-circuiting is the design: a policy listener returns without `next()` when it owns the decision, while a listener that only annotates or observes MUST delegate — a missing `next()` is a silent takeover by design, so never omit it accidentally. The dispatch mode is part of an event's public contract; other modes exist (`emit` broadcast, `bail` first-non-undefined, `serial` ordered) but interception points use waterfall.

## Which extension point

| Goal | Point |
|---|---|
| Allow / deny / ask policy on tool calls | `tools/pre-execute`, returning a typed `PreToolDecision` |
| Final monotonic denial later listeners cannot undo | `ctx.tools.guard()` |
| Wrap dispatch lifetime: timeout, retry, metrics | `tools/execute` (only `exec.signal` is replaceable) |
| Transform the result, replace presentation, block, attach model-facing context | `tools/post-execute` |
| Observe the immutable normalized outcome: audit, capture | `tools/result` |
| Intercept a request, step, or turn | `agent/*` events; `agent/turn-stopping` is the event that stops a turn |
| Short-circuit or route a model call | `llm/stream` waterfall |
| Enforce a monotonic terminal turn policy | `ToolExecution.concludeTurn()` from the terminal tool |

Execution order across the tool pipeline: the `tools/pre-execute` waterfall runs first, monotonic guards next, then the `tools/execute` and `tools/post-execute` waterfalls; definition-owned `finalizeContent` and `tools/result` run afterward. Denied or approval-refused calls skip the tool body. `tools/result` observes the frozen, lossless-JSON outcome; `tools/post-execute` runs before normalization and can transform the result or attach context.

## The permission-gate template

```ts
import type { Context } from 'cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

declare function isAllowed(exec: ToolExecution): Promise<boolean>

export const name = 'permission-gate'

export function apply(ctx: Context) {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!(await isAllowed(exec))) {
      return { kind: 'deny', reason: 'Denied by policy.' }
    }
    return next()
  })
}
```

The typed decisions are `{ kind: 'allow' }`, `{ kind: 'deny', reason }`, and `{ kind: 'ask', ... }`; an `ask` resolves through `ctx.approval` as a one-shot prompt, and an absent or unanswerable approval denies. This waterfall is the reorderable policy layer: sandbox, permission, and plan-mode plugins use it. Use `ctx.tools.guard()` when an invariant needs a monotonic final denial that a later listener cannot undo; `tools/execute` when the plugin must wrap the actual dispatch lifetime (timeouts, retries, metrics — only `exec.signal` is replaceable); `tools/post-execute` for explicit result transformation; `tools/result` for contained observation of the immutable final outcome.

## Rules

- A listener registered with `ctx.on()` is an effect: it is removed when the plugin unloads. Registration and disposal are effect-based everywhere.
- Prefer events for interception and policy; prefer service methods for direct capability calls.
- Do not build deployment policy into tools; keep policy in hook plugins so it stays reorderable and spans tool families without coupling the tools to one policy service.
- Scoped listeners filter dispatch; register on `agent.ctx` to scope policy to one agent. `agent.ctx` contributions unwind with awaited cleanup when the agent disposes.
- Typed events use declaration merging on the `cordis` `Events` interface and document their dispatch `@mode`; harness event names are `namespace/action` (`tools/pre-execute`, `agent/request`, `agent/turn-stopping`).

## Verification

Unit-test the decision logic (each decision kind, the short-circuit and delegate paths). Prove with a REAL-composition test that the gate actually blocks and that a denied call produces no side effect — a guard only guards if the regression actually fails it; for an inject-less hook plugin add `expect('default' in mod).toBe(false)` plus an `unwrapExports` round-trip assertion and prove it by introducing the regression. Model- or human-visible behavior changes require a keyless snapshot in the same change.
