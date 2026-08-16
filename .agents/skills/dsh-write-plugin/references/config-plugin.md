# Config plugin reference

Accept user configuration supplied through `cordis.yml`. This reference is self-contained: it carries the schema contract, the configuration rules, and the loader constraints.

## The shape

Export a `Config` type and a same-named Schemastery schema; put defaults directly on the schema fields:

```ts
import type { Context } from 'cordis'
import Schema from 'schemastery'

export interface Config {
  greeting: string
  maxRetries: number
  verbose?: boolean
}

export const Config: Schema<Config> = Schema.object({
  greeting: Schema.string().default('Hello'),
  maxRetries: Schema.number().default(3),
  verbose: Schema.boolean().default(false),
})

export function apply(ctx: Context, config: Config) {
  // User value or schema default; validated and type-safe.
}
```

Consumers supply values through the plugin row's `config` in `cordis.yml`; when loading, Cordis validates the supplied values against the exported schema and fills defaults. Do not export a plain object as `Config`; it does not implement the Standard Schema interface Cordis requires. Use Schemastery for stricter validation: `Schema.string().required()`, `Schema.number().default(30000)`, `Schema.union(['fast', 'accurate']).default('fast')`. The schema runs while the plugin loads; invalid configuration fails the load with an actionable error.

## Rules

- **No hardcoded tunables.** Anything two deployments may want to set differently must be a configuration field — the test is whether `cordis.yml` can change the value without a code edit. A `DEFAULT_*` constant or a test hook is not configurability. Protocol constants, external specs, and security invariants stay fixed.
- **Fail loudly on invalid configuration.** Express self-contained constraints in the schema so invalid configuration fails while the plugin loads; references to services or registered resources require dependency injection (`inject`), never the schema.
- **`!!js` (never `!js`) is allowed only under plugin `config`.** Loader metadata is static — `id`, `name`, `group`, `disabled`, `inject`, `intercept`, and `isolate` remain literal — so `disabled: !!js ...` is a truthy object that always disables the entry. Use explicit config overlays when environment selection changes which plugins are mounted.
- **Secrets stay out of configuration values.** Use schemastery env fallbacks fed from `cordis.yml` via `!!js process.env.MY_KEY`, or named secret references through `ctx.credentials` (resolved per operation, never inlined in configuration); never inline credentials in config or read ad-hoc key files in code.
- **Explicit over implicit at package boundaries.** Defaulting is an explicit `resolve(request): Spec` step in the owning implementation, never a hidden `?? default` inside `run()`.
- **HMR is automatic.** A configuration edit hot-replaces the plugin: the framework unloads the old instance and loads a new one; because registrations are effects, the old instance's registrations clean themselves up.

## Verification

Unit-test the schema's acceptance and rejection cases (valid values, invalid values, missing required fields, defaults applied), and assert that misconfiguration fails the load loudly rather than being silently skipped. The schema ships in the package's published entry, so the built-entry and REAL-composition checks apply: a package `bin` runs built `lib/bin.js` under plain Node, and a genuinely-missing config exits non-zero. The per-file 100% coverage gate covers the package source.
