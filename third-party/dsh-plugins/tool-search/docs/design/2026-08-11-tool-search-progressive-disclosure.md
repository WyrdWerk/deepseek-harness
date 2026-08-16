# Agent Note: Per-agent tool search and progressive disclosure

Status: implemented

English | [中文](2026-08-11-tool-search-progressive-disclosure.zh.md)

## Problem

The tool registry already has the hard part of visibility policy — agent-scoped registrations and intersecting `ctx.tools.restrict()` filters — but every visible global tool schema still enters each model request. A product with many built-in or MCP tools therefore pays prompt and cache cost before the model needs most capabilities. The extension cookbook names ToolSearch as the intended restriction replacement, and external harnesses now expose the same ordinary product behavior: discover a capability by exact name or description, then load its full schema for a later request. What the functional baseline lacked was not a new core seam, but a package that owns ranking, durable per-agent selection, dynamic registration safety, model output, and assembled-application evidence; scale benchmarks determine whether real KV Cache optimization needs a smaller ordering seam.

## Decision

Maintain unreleased `@deepseek-ai/dsh-tool-search` as the standalone private `dsh-external/dsh-tool-search` plugin. The package mounts one scope-local `tool_search` and one plugin-owned allow restriction for each current and future agent. `alwaysVisible` patterns keep a small deployment-chosen global set in the initial request. Search ranks exact callable names ahead of deterministic lexical name/description BM25 matches, caps the result through validated config, and widens only the plugin-owned allow set. It installs a replacement restriction before lifting the old one so no synchronous observer sees an unprotected interval.

The search result returns names and `loaded`, `already_loaded`, or `unavailable`; it never copies full schemas into tool history. Newly allowed schemas enter the next ordinary request header, keeping `request/header` as the authoritative model-input record. An independently filtered tool may be ranked but cannot become executable: all restrictions continue to intersect and `unavailable` reports that outcome.

Selections are per-agent cumulative sets. Each successful widening appends `tool-search/selection` with the trimmed query and the full code-point-sorted selected set. Recovery and seeded forks read the latest snapshot before first assembly. The package invariant companion validates exact data shape and requires every later snapshot to be a strict superset. HMR attaches existing agents, tracks later agents, and removes its registrations and restrictions on unload.

Dynamic registration is fail-closed. The initial catalog includes only globals visible through the agent's already-composed scope. A late global/MCP tool may join only if every initial global was visible; an agent that began behind any other restriction freezes its eligible-name set because the registry deliberately does not expose another plugin's filter internals. An explicit `alwaysVisible` pattern remains the deployment override for known late names.

The first version supports Native Tool Mode only. A `tool_search` call carrying a parent execution token fails before mutation because Code Mode hides native schemas behind `run_code` and needs a distinct SDK discovery contract.

## Alternatives considered

**Add a second registry or modify `agent-loop`.** Rejected: `ctx.tools.schemas(scope)`, scope-local registration, `tools/change`, and intersecting `restrict()` already express the complete Native visibility operation. Duplicating the registry would split prompt and execution authority; changing the loop would put plugin behavior in the spine. This decision does not rule out the project team adding a minimal tool-registry seam that affects only schema ordering, not resolution or permissions.

**Use provider-native hosted tool search only.** Rejected for the baseline: it would bind harness behavior to one provider/model family. The client-side tool works with any adapter and supplies keyless deterministic tests. A future provider adapter may optimize the same package contract when native semantics and cache evidence match.

**Search only exact names.** Rejected: exact names are the strongest ranking signal but users and models often describe a capability rather than recall its callable name. Description BM25 adds no service or network dependency and deterministic ties make snapshots portable.

**Return full schemas inside the search result.** Rejected: it duplicates the token cost in retained history and the next request header. Names and statuses explain the state change; the tool registry remains the one schema source.

**Admit every late global tool for every agent.** Rejected: a pre-existing parent or tool filter may intentionally hide names. Because restriction internals are not public, assuming a late name is safe would turn discovery into a policy side channel.

**Ship directly as a stable package.** Rejected: the contract still needs real-provider cache and latency benchmarks, namespace behavior for large MCP servers, and a Code Mode decision. Experimental placement enables internal use without weakening tests, docs, or lifecycle rules.

## Consequences

Native products can opt into a small initial tool schema surface without losing on-demand access to eligible globals. Search selection survives recovery and forks, remains independent across agents, and composes with existing filters. Exact-name lookup avoids the common lexical miss where a full callable name loses to description terms. The full model input stays reconstructable from `request/header`, while `tool-search/selection` explains why visibility changed.

The keyless [scale benchmark](../reports/2026-08-11-tool-search-benchmark.md) mixes 40 first-party tools from a generated Harness catalog with deterministic MCP fixtures. Across 10/30/50/100 tools, estimated initial tool-schema tokens fall by 92.1%–99.1% and remain 85.3%–98.3% lower after one tool is selected; exact name @1 and 10 representative capability queries @5 both reach 100%, while deferred tools always add one model turn. These results prove only the fixed character estimate and lexical corpus, not a real tokenizer, model-use quality, billing, or provider cache hit rate.

The same benchmark also exposes a mainline boundary: after the first selection, serialized tool schemas retain only about 2% of the initial prefix because the registry emits newly visible global tools before the scope-local `tool_search`. Repeated selection remains byte-for-byte stable, but strong KV Cache gains require stable schema ordering or a formal deferred contribution seam. The selected tool cannot be copied into a scope-local shadow to adjust ordering because that could bypass an independent global restriction; if the project team adds a seam, it must change only model-visible ordering, not tool resolution or permission intersection.

The package adds one fixed search schema and retains each state-changing search result/event; selected schemas then remain visible until session end or compaction does not affect them. Catalog ranking is lexical, in-process, and linear in eligible tool count. Restricted agents intentionally do not discover unknown late registrations. Code Mode, embeddings, namespace loading, provider-native delegation, and released-bundle inclusion remain explicit follow-up gates rather than hidden compatibility promises.
