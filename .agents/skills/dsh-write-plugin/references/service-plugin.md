# Service plugin reference

A service is a capability one plugin exposes to other plugins through `ctx`; `tools`, `llm`, and `agents` are services. This reference is self-contained: it carries the service shape, the typed-event contract, the lifecycle rules, and agent-scope semantics.

## The shape

```ts
import { Service, type Context } from 'cordis'

declare module 'cordis' {
  interface Context {
    metrics: MetricsService
  }
}

export default class MetricsService extends Service {
  static inject = ['llm']  // A service may depend on other services.

  constructor(ctx: Context) {
    super(ctx, 'metrics')  // 'metrics' is the service name.
  }

  record(event: string, value: number) { /* ... */ }
}
```

After loading, consumers access the service as `ctx.metrics`; they declare `inject: ['metrics']` and use it in `apply`. Use class form when the plugin provides a service to other plugins; function form suffices for a plugin that only consumes. Public service methods document their parameters and non-void returns with JSDoc `@param`/`@returns`. The service name is the string passed to `super(ctx, ...)`; service names, public methods, and source locations are recorded in the generated subsystem pages — do not maintain a second static list.

## Dependencies

`inject` lists required services: the plugin does not load while a service is absent and waits until every declared service is ready — `ctx.tools` exists and is ready inside `apply`. Optional dependencies omit `inject` and query with `ctx.get('name')` at the use site, guarding the possibly-absent result. If a required service disappears at runtime (its provider unloads), dependent plugins dispose automatically and load again when the service returns; this prevents a plugin from calling a service that no longer exists. `cordis.yml` can isolate a service per plugin group (`isolate: { bash: true }` on a group row) so separate plugin groups see separate instances of the same service with no cross-group effect.

## Typed events

Events are the loose-coupling extension API between plugins. Declare them through TypeScript declaration merging on the `cordis` `Events` interface with `namespace/action` names, and document the dispatch mode with `@mode`:

```ts
import 'cordis'

declare module 'cordis' {
  interface Events {
    'my-plugin/ready': (payload: { id: string }) => void
    'my-plugin/check': (input: string) => boolean | undefined
    'my-plugin/transform': (input: string, next: () => Promise<string>) => Promise<string>
  }
}
```

Dispatch modes: `emit` (broadcast — every listener runs synchronously, return values ignored), `bail` (short circuit — listeners run in order, the first non-`undefined` result becomes the final result), `serial` (ordered execution — listeners run in registration order, the first non-empty value stops further execution), `waterfall` (pipeline — each listener may wrap the downstream result and MUST call `next()` to delegate; omitting it short-circuits by design). A listener registered with `ctx.on()` is an effect: it is removed when the plugin unloads. Harness event names are `namespace/action` (`agent/step`, `agent/request`, `agent/request-error`, `tools/result`, `session/event`). `turn/*`, `step/*`, `tool/call`, `tool/result`, and `compact/*` are durable session-event types, not same-named Cordis events: to observe them, listen to `session/event` and inspect `event.type`.

## Lifecycle

Loading is dependency-driven; anything registered through `ctx` — event listeners, tools, timers — is cleaned up when the plugin unloads, with no manual `removeListener` or `clearInterval`. For a resource that needs explicit teardown, such as a network connection, provide its disposer through `ctx.effect()`; if teardown order matters, keep the related work in one effect so disposal unwinds in the intended sequence. A configuration edit hot-replaces the plugin: the framework unloads the old instance (its registrations unwind) and loads a new one.

## Agent scope

Each agent owns a scoped `agent.ctx`; registrations made there file into that agent's layer and unwind with awaited cleanup when the agent disposes. Scoped listeners filter dispatch, and shared storage overlays its entries on the global registries while preserving domain views. `CreateAgentOptions.setup(agentCtx)` composes before publication. Scope a registration to one agent by using its `agent.ctx` instead of the root context; a service row that must live in an agent preset needs an `isolate` realm.

## Capability seam

A swappable capability comprises three roles: Service Definition (the interface), Service provider (an implementation), and Consumer (model-facing or integration code that uses the service). Split the roles into separate packages only when they evolve independently — the bash trio (definition, provider, consumer) is the template; a single-purpose service stays one package. A capability seam is complete only with all three roles; split a package only when the roles genuinely evolve independently.

## Verification

Unit tests including the HMR-safety test (dispose the contributing fiber, assert cleanup), the per-file 100% coverage gate, and — for a product-visible plugin — a non-unit REAL-composition test booting `cordis.yml` through the Loader and asserting model-visible request/log, durable state, or user-visible output. Model-, protocol-, or human-visible changes add a keyless snapshot in the same change.
