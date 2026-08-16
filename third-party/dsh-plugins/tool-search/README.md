# @deepseek-ai/dsh-tool-search

English | [中文](README.zh.md)

An experimental external Native Tool Mode plugin for per-agent tool discovery and progressive schema disclosure. Each live agent sees one scope-local `tool_search` tool plus the global tools matched by `alwaysVisible`; other eligible global tools stay executable only after `tool_search` selects them. The plugin uses the existing `ctx.tools.restrict()` seam and does not change `agent-loop`.

This private repository is the plugin's source of truth. The package is unreleased and carries no compatibility promise. See the [scale benchmark report](docs/reports/2026-08-11-tool-search-benchmark.md) for keyless 10/30/50/100-tool results and the [design record](docs/design/2026-08-11-tool-search-progressive-disclosure.md) for the decision and trade-offs.

## Installation

The repository is private and the package is not published to an npm registry. Install a reviewed commit directly from GitHub with Git credentials and pnpm `11.7.0`; install it separately into every profile that should use tool search. The `-w` flag is required because a DSH profile is a pnpm workspace root:

```sh
dsh plugin --profile headless add -w github:dsh-external/dsh-tool-search#<reviewed-commit>
dsh plugin --profile web add -w github:dsh-external/dsh-tool-search#<reviewed-commit>
dsh --profile web --dump-config
```

The package's `dsh.bundle.patch` loads both the runtime plugin and its invariant companion. Profiles are independent; installing into `web` does not enable `headless`. `--dump-config` must show `tool-search` and `tool-search-invariant` before the profile is booted. Remove the bundle from one profile with `dsh plugin --profile <profile> remove -w @deepseek-ai/dsh-tool-search`.

## Config

```yaml
- id: tool-search
  name: '@deepseek-ai/dsh-tool-search'
  config:
    alwaysVisible: [read_file, todo_*]
    maxResults: 5
    maxQueryChars: 512
```

| Key | Default | Meaning |
|---|---:|---|
| `alwaysVisible` | `[]` | Global tool-name patterns that remain visible before search. Only `*` is a wildcard; every other character is literal. |
| `maxResults` | `5` | Largest allowed result limit for one search. |
| `maxQueryChars` | `512` | Largest trimmed query accepted in JavaScript characters. |

Invalid positive-integer bounds, empty or whitespace-padded patterns, and repeated patterns fail at plugin load. A model may request a smaller `limit`, from `1` through `maxResults`; it cannot raise the deployment bound.

## Selection and safety

Search ranks exact callable names first, then name and description matches with deterministic BM25 scoring and code-point name tie-breaking. A successful expansion writes one `tool-search/selection` session event containing the trimmed query and the complete sorted selected-name set. Later events must be strict cumulative supersets; the invariant companion enforces the event shape and monotonic rule for live and restored sessions.

Each agent owns an independent selection and restriction. A resumed or forked session restores the latest selection before its first request. Installing the plugin after agents already exist attaches them; unloading it removes `tool_search` and lifts only its own restrictions.

This plugin never widens another filter. Existing creation-time restrictions, parent/subagent policy, scoped shadows, and other `ctx.tools.restrict()` calls still intersect after search, so a selected but independently denied tool reports `unavailable`. The initial catalog includes only globals already visible to that agent. Late global registrations such as MCP tools join the catalog only when the agent started with an unrestricted global view; an agent that started behind another restriction stays on its original eligible-name set. `alwaysVisible` is the explicit override for a known late name pattern.

## Model Experience

### Tool schema

#### What the model sees

Every protected agent sees the following description even when no global tool is initially visible; the complete declaration lives in [`src/index.ts`](src/index.ts). The schema has `query` (required string) and `limit` (optional integer bounded by config). The tool is scope-local, so this plugin's global allow-list cannot hide it.

##### Tool description

```markdown
Search tools that are not currently visible. Describe the capability you need or name a tool exactly. Matching tools are loaded for the next model request; call them only after this result returns.
```

#### Token effect

The fixed `tool_search` schema and the `alwaysVisible` schemas are paid on every request. Deferred tool schemas cost no request tokens until selected. A search result adds a small retained history entry; selected full schemas begin on the next request.

#### KV Cache effect

The request prefix stays stable while the selected set and registry stay unchanged; selecting the same tool again does not change the schema list. The current registry emits newly visible global tools before the scope-local `tool_search`, so the serialized tool schemas after the first selection retain only about 2% of their initial prefix in the [keyless scale benchmark](docs/reports/2026-08-11-tool-search-benchmark.md). Functional behavior is unaffected, but strong KV Cache gains require the mainline to provide stable schema ordering or a formal deferred contribution seam. Tool registration, removal, or plugin lifecycle can also change the schema prefix.

### Search result

#### What the model sees

Matching results use the following concise format. No match renders `No matching tools found.` The canonical value also includes the trimmed `query`, ordered `tools` records, and `remainingDeferred`. `loaded` means the tool became visible, `already_loaded` means it was already visible, and `unavailable` means another restriction still blocks it. Full schemas are not copied into the result; they arrive through the next normal request header.

##### Result example

```markdown
Tool search results:
- <tool_name>: <loaded|already_loaded|unavailable>
Remaining deferred tools: <count>.
```

#### Token effect

Result size is bounded by `maxResults` and retained until compaction. The newly selected schemas then add their normal fixed per-request cost.

#### KV Cache effect

The result appends after the reusable history prefix. The following request changes its schema prefix when at least one tool was newly selected.

### Argument errors

#### What the model sees

Blank or overlong queries, an out-of-range or non-integer `limit`, calls without the owning live agent, and nested Code Mode dispatch return ordinary tool errors. A failed call does not change the selection or append `tool-search/selection`.

#### Token effect

The error result enters history as an ordinary tool result and is retained until compaction; it introduces no deferred tool schemas.

#### KV Cache effect

The error result appends after the existing prefix and does not change the tool-schema prefix. If the same failure occurs again, it extends the request like any other new history.

## Known Limitations and Deferred Work

- **Native Tool Mode only.** Calls nested under `run_code` fail loud; Code Mode needs a separate SDK/search transport contract.
- **Lexical search only.** Exact names, name boosts, descriptions, and BM25 achieve 100% recall for exact name @1 and representative capability queries @5 in the keyless scale benchmark; this small fixed corpus does not represent ambiguous queries, multilingual queries, or real model-use quality. Embeddings and provider-native search remain deferred.
- **Global tools only.** Agent-scoped tools are already visible and never enter the deferred catalog. MCP resources and prompts are outside the tool registry and need their own consumer seams.
- **Conservative late-tool policy.** Any restricted initial global view freezes the eligible-name set, so a harmless later registration may stay undiscoverable unless `alwaysVisible` names it.
- **No namespace grouping.** Individual tool names remain the selection unit; large MCP servers may need a namespace-level result and load operation.
- **No real provider cache benchmark.** Current token counts use the repository's fixed character estimate, and KV Cache compares only structural prefixes; no real tokenizer, bill, cache bucket, or end-to-end latency was measured.
- **Private Git distribution.** The package is not published to a registry; installation requires authorized GitHub access, pnpm `11.7.0`, a reviewed commit, and a compatible DSH profile.

## Development and verification

The checked-in `lib/` output is installable without rebuilding. The project `.npmrc` selects the private `@deepseek-ai/*` scope; pnpm 11 reads its `${NPM_TOKEN}` authentication mapping from the trusted user-level `~/.npmrc`. Set `NPM_TOKEN`, then run `pnpm install --ignore-scripts` and `pnpm run check`. The SDK packages are pinned to the reviewed `0.0.1-rc.2` set. Do not link a DSH source checkout into this repository. The optional benchmark also requires `DSH_TOOL_CATALOG_PATH` to name an exported DSH tool catalog. The `compat/` directory is an external compatibility fixture, not a source-development dependency.
