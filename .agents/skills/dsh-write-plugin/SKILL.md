---
name: dsh-write-plugin
description: Use when asked to create a plugin or workspace package in the deepseek-harness repo, from scaffolding through verification, or to decide which plugin shape fits a requested capability. Routes tool, LLM adapter, hook, service, and config shapes to their reference files.
---

# Writing a DeepSeek Harness Plugin

Create one plugin as one workspace package under `packages/<group>/<pkg>`. Classify the shape first, read its reference file, walk the package checklist below, then verify with the smallest gates that cover the change. This skill is self-contained: every rule it needs is written here or in its reference files.

## Classify the plugin shape first

| Requested capability | Shape | Reference file |
|---|---|---|
| A model-facing tool: read/write files, run commands, search the web | Tool plugin | `references/tool-plugin.md` |
| A new model provider | LLM adapter plugin | `references/llm-adapter-plugin.md` |
| Intercept requests, tools, or turns: permission, policy, metrics, telemetry | Hook plugin | `references/hook-plugin.md` |
| A capability other plugins consume through `ctx` | Service plugin | `references/service-plugin.md` |
| User-configurable behavior through `cordis.yml` | Config plugin | `references/config-plugin.md` |

A plugin combines shapes freely (a tool plugin with Config, a service that also registers a tool); each shape's contracts still apply. When the request matches none of the five shapes, map it to an extension point and write a plugin that registers there; never change the agent loop itself.

| Goal | Mechanism |
|---|---|
| Add a model-facing capability | register on `ctx.tools` |
| Add a model provider | register an adapter on `ctx.llm` |
| Give one session a different capability set | compose it in an agent preset |
| Add shell execution | implement and register a `ctx.bash` backend |
| Add persistent terminal execution | register a `ctx.pty` backend plus `dsh-tool-pty` |
| Add a human command | register on `ctx.commands` |
| Add background work | register on `ctx.tasks` |
| Add filesystem access or policy | implement a `ctx.fs` provider or listen to `fs/*` policy events |
| Confine spawned processes | use a `ctx.sandbox` backend |
| Intercept a request, tool, or turn | use `agent/*` or `tools/*` events; `agent/turn-stopping` is the event that stops a turn |
| Add model-facing context | call `agent.inject()` |
| Add UI or editor integration | drive `ctx.agents` and render from `session/event` |
| Web Client Chat node | register a `ConversationNodeDefinition` plus a keyed renderer |
| Add durable session state | extend `SessionEventMap`; render and replay from the log |
| Fork a live session | call `ctx.sessions.fork(source, boundary?, childSessionId?)` |
| Scope a registration to one agent | use its `agent.ctx` |

## The package checklist

1. **Create the package** — `packages/<group>/<pkg>/` with `package.json`, `tsconfig.json`, `src/index.ts`, and `README.md`. Copy `package.json` from `packages/core/tools` and adjust name, description, and dependencies; keep its invariants: `private: true`, a `version` matching root, `type: module`, `main: "lib/index.js"`, `types: "lib/types/index.d.ts"`, `exports["."]` with `types` and `default` pointing into `lib`, `cordis` in both peer and dev dependencies with the same range, every dsh peer dependency mirrored in dev, `schemastery` in `dependencies` (it is a runtime validator), and a `files` list containing exactly `lib/index.js`, `lib/invariant.js`, `lib/types/**/*.d.ts`, and package-specific runtime artifacts; a CLI app package with a `bin` includes `lib/bin.js` immediately after `lib/index.js`. Do not publish `src`, declaration maps, JS maps, or stale root declaration files. In-package relative imports use explicit `.ts` specifiers in source (the compiler rewrites them to `.js` in emitted JS). Pick an existing group when one matches the role (`core`, `llm`, `bash`, `compact`, `subagent`, `todo`, `session-persistence`, `ui`, `util`, `support`); a new group is allowed but is a pure container — no `package.json`, no source files, and packages sit exactly one level below it.

2. **Register it in the root configs** — add `{ "path": "./packages/<group>/<pkg>" }` to the `references` of `tsconfig.host.json` (Host package) or `tsconfig.client.json` (Client package): an ordinary package belongs to exactly one aggregate, never both; the `api/remotes` split is a repository-specific exception, not a template for new packages. Touch `knip.json` only when the package has entrypoints that repository discovery does not already cover. A `packages/client/*` package instead extends `tsconfig.base.client.json`, declares `dsh.client` in package.json, exports `./client`, and calls the shared client tsdown preset (`packages/client/tsdown.client.ts`). Covered automatically by globs or package-manifest discovery — no edits needed: root `package.json` workspaces, `scripts/publint-all.ts`, `tsdown.config.ts`, `.oxlintrc.json`, `scripts/check-workspace-constraints.ts`.

3. **Decide the package topology** — for a swappable capability, separate Service Definition / Service provider / Consumer roles into packages when they evolve independently (the bash trio is the template); a single-purpose plugin stays one package.

4. **Write the package README** — keep package-specific service API, config, events, extension points, and design notes first. End the README with the canonical Model Experience sequence and the Known Limitations and Deferred Work section. Fill Model Experience from the implementation: one H3 per direct, conditional, capped, lifetime, or auxiliary-model surface, with the three ordered H4 fields below and one prose paragraph under each; quote stable text owned by the package; a tool-schema surface states only deltas absent from the generated tool catalog. In `KV Cache effect`, distinguish append-only growth, a stable repeated prefix, replacement of earlier request tokens, and an independent model request, then name the package-owned changes that can invalidate reuse; "does not invalidate" means the package preserves an already-reusable prefix. A package with no context effect uses the audited `None` or `Indirectly, through ...` sentence forms; a model-agnostic generic package may join the `NO_MODEL_EXPERIENCE_SECTION` allowlist.

   ````markdown
   ## Model Experience

   ### Request surface and condition

   #### What the model sees

   The exact data-dependent fields, an anchored generated-catalog link, or an introduction to the verbatim literal below.

   ##### Verbatim text for this field, when needed

   ```markdown
   Stable system-prompt prose of any length, or another long non-generated literal, copied exactly from source.
   ```

   #### Token effect

   Fixed, conditional, retained, replaced, capped, or zero-direct token effect.

   #### KV Cache effect

   Append-only, prefix-stable, replacing, or independent behavior, including the exact conditions that may invalidate reuse.

   ## Known Limitations and Deferred Work

   - **Consumer-visible gap** — exact missing operation or case, its consequence, and any maintainer constraint.
   ````

5. **Verify** — run the verify block below, then the behavior-specific checks and coverage the change needs.

## While writing

- Every registration is an effect: register through `ctx` helpers or `ctx.effect()` with a disposer, and let plugin unload clean everything up — event listeners, tools, and timers included.
- New behavior goes on a documented extension point; nothing here changes `agent-loop`.
- Public service methods and typed events carry JSDoc with `@param`/`@returns`; typed events use declaration merging on the `cordis` `Events` interface and document their dispatch `@mode`.
- No hardcoded tunables: deployment-varying values are validated `Config` fields changeable from `cordis.yml`.
- Anything a model sees must be reconstructable from the session log.
- Misconfiguration fails loud: never silently skip a missing referent; validate at parser/config, wire, and process boundaries rather than trusting typed same-process callers.

## Verification

```sh
pnpm install            # registers the workspace
pnpm run doc-sync
pnpm run constraints && pnpm run typecheck && pnpm run lint
pnpm run build && pnpm run hygiene
```

Choose tests by change surface: unit tests for logic, the per-file 100% coverage gate for package source, real-API e2e (with a provider key) for provider behavior, keyless snapshots for any model-, protocol-, or human-visible behavior, and a REAL-composition test (booting `cordis.yml` through the Loader) for product-visible plugins — see `references` of this skill for each shape's specifics. A package `bin` entry additionally needs a built-artifact smoke running `lib/bin.js` under plain Node.
