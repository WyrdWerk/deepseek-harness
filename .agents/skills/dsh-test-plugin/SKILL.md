---
name: dsh-test-plugin
description: Use when writing or reviewing tests for a deepseek-harness plugin or package change — choosing the test tiers (unit, coverage, real-API e2e, snapshot, web browser), deciding when a snapshot is required, and covering the real entry path including built-bin smokes.
---

# Testing a DeepSeek Harness Plugin

Decision procedure, self-contained: select the smallest set of test tiers that proves the change, and never default to the full suite or repeat a passing check. The tiers, their commands, and their required-coverage rules are all written below.

## The tiers

| Tier | Command | What it proves |
|---|---|---|
| Unit | `pnpm run test` | vitest specs under the package's `tests/**` directories plus repository script specs under `scripts/**/*.spec.ts`; edge cases, error paths, event ordering, concurrency races, contract regressions. Every registry gets an HMR-safety test (dispose the contributing fiber, assert cleanup). |
| Coverage gate | `pnpm run test:coverage` | per-file 100% on `packages/*/*/src`. An uncovered line is often dead code the gate is flagging for deletion, not a missing test to bolt on; line coverage is necessary, never sufficient — it proves lines ran, not that the feature works as shipped. |
| Real-API e2e | `pnpm run test:e2e` | behavior against live provider APIs — the DeepSeek model plus provider-specific smokes gated on their own keys (`EXA_API_KEY`, `PERPLEXITY_API_KEY`, ...). Each suite self-skips without its key so keyless CI stays green. |
| Snapshot | `pnpm run test:snapshot` | keyless expected outputs: transport contracts and presentation, while persisted logs pin assembled backend behavior. |
| Web browser snapshot | `pnpm run test:web` | replayed Chromium output vs `apps/web/tests/snapshots/`; the required Linux PR gate. CI forces read-only `DSH_SNAPSHOT=replay`, never writing expected outputs; record and refresh stay local and every diff is reviewed. |

The with-key policy: inference is cheap here — do not ration real-API tests. A no-key test proves plumbing; only a with-key run proves the agent works against a real model. Cover file-writing prompts, multi-turn conversations, tool use, and mid-stream cancellation. Highest-value are smoke tests that boot the real example, send one prompt, and check the world — they catch the "green unit tests, broken product" class that mocks cannot. Self-skip keeps secretless CI unblocked; it is not a cost signal.

## Decide tiers from the change surface

- Pure logic or an internal helper → unit only.
- New or changed package source → the coverage gate (per-file 100% on the owning `packages/*/*/src`).
- Model-visible behavior (prompt, tool schema, tool output, skill catalog) → a keyless snapshot in the owning example's suite plus a real-composition test.
- Protocol-visible behavior (ACP, JSON-RPC, wire transport) → a keyless snapshot in the owning example's suite.
- Human-visible behavior (CLI transcripts, interactive terminals, GUI journeys) → `apps/cli/tests/snapshots/` or `apps/web/tests/snapshots/`.
- Provider behavior (a new adapter, real provider quirks) → real-API e2e with the key.
- A product-visible plugin (anything shipped to users) → a non-unit REAL-composition test (see below), never only hand-built `ctx.plugin(...)` suites.

## When a snapshot test is required

Every non-trivial model-, protocol-, or human-visible change adds or updates a keyless scenario in the same PR through a runnable example's owning snapshot suite. Package tests, e2e assertions, mock/test-only compositions, and PR rationale do not replace the assembled transcript; extend the harness when needed. Suite owners: ACP automation scenarios live in `examples/<name>/tests/snapshots/` as a scenario table over the `dsh-acp-snapshot` suite factory (`examples/acp-agent` is primary); headless canonical-event JSONL snapshots and replay fixtures live in `examples/headless-agent`; completed interactive-terminal journeys use JSONL-driven scenarios under `apps/cli/tests/snapshots/`; browser-rendered web GUI journeys use `apps/web/tests/snapshots/`. A scenario that boots real `pwsh` skips where `pwsh` is absent. Use `pnpm run test:snapshot:record` when a model transcript changes and `test:snapshot:refresh` when replay input remains valid; review every JSONL and expected-output diff. New capability seams, lifecycle variants, or transcript surfaces name every coverage tier at plan time and verify the harness can express it before implementation.

## Test the real entry path

- Product-visible plugins require a REAL-composition test: boot test-only `cordis.yml` through the Loader and app/process, mock only external services or nondeterministic inputs, and assert model-visible request/log, durable state, or user-visible output. Keep opt-ins out of shipped defaults.
- A guard only guards if the regression actually fails it. For a plugin without `inject` (bundle/composition plugins), a Loader smoke stays green when a default export replaces the required named exports — add an explicit `expect('default' in mod).toBe(false)` plus an `unwrapExports` round-trip assertion, and prove it: introduce the regression, watch red, revert.
- "Real entry path" means the published artifact: a package `bin` runs built `lib/bin.js` under plain Node, exposing failures tsx masks (settle races, module resolution, swallowed load failures). The same applies to non-index runtime entries (the worker-thread sibling `lib/worker.cjs`) and singleton modules shared across bundles. Keep the built-artifact smokes green (`packages/examples/*/tests/built-bin.e2e.ts`, `packages/code-runtime/code-runtime-worker/tests/built-lib.e2e.ts`), and assert a genuinely-missing config exits non-zero.
- Test resolution stays on the source plane: workspace imports resolve to `src`, never through package `exports` to stale built `lib/` — stale artifacts there load a second copy of module singletons. Built artifacts are consumed only explicitly: `lib`-mode subprocesses and the built smokes.
- Subprocess launch modes: CI and build-having test lanes run every example or Cordis-config subprocess from built `lib/` through the shared dual-mode launcher; never hand-write `--import tsx` for these subprocesses. Protocol and operating-system fixtures that do not load Cordis run erasable `.ts` directly with Node, without tsx or the root paths map. Only a test whose subject is source-path resolution may select `src`; state that contract in the test.

## Keep tests meaningful

- Prefer the real implementation over a mock. Mock only the expensive or non-deterministic boundary (LLM adapter, network, clock) and keep everything downstream real — a hand-rolled stand-in proves the bridge moves bytes, not that the shipping tool behaves as asserted. Bridge tool-call tests use the scripted mock model with the real tool and executor.
- Verify the world, not the self-report: an e2e assertion re-runs the command or re-reads the file externally; a keyword probe on the agent's own output lets a cheating agent pass. Assert untouched files are byte-identical.
- e2e tests own their resources: create the harness in the test, dispose in `afterEach` even on failure, retry, or timeout; shared fixtures live in a plain `tests/harness.ts`, never another `*.e2e.ts` (importing a spec re-registers its `describe` and duplicates real API calls).
- Recovery tests separate pre/post-chunk failures by step and prove failed chunks derive no message or tool side effect; cover exhaustion, cancellation, policy composition, persistence, status, wire counts, transport-closing idle timeouts, and shipping Loader composition.

## Commands

`pnpm run test`, `test:coverage`, `test:e2e`, `test:snapshot`, `test:snapshot:record`, `test:snapshot:refresh`, `test:web`; the complete local gate set is `pnpm run check:all`. Run the smallest set that covers the changed surface once; CI owns exhaustive coverage, built-artifact smokes, and the platform matrix.
