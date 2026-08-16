# `dsh-tool-search` Scale Benchmark Report

English | [中文](2026-08-11-tool-search-benchmark.zh.md)

> Snapshot time: 2026-08-11 (Asia/Shanghai). The results come from the current local working tree and use a keyless, reproducible in-repository benchmark; no paid model API was called.

## Conclusion

Across mixed sets of 10, 30, 50, and 100 tools, `dsh-tool-search` reduces the estimated token count for initial tool schemas from 1,615–14,199 to a constant 127, a saving of 92.1%–99.1%. It still saves 85.3%–98.3% after one tool is selected. Exact-name search across all tools at @1 and 10 representative capability queries at @5 both reach 100%, at the cost of a fixed increase of 1 model turn before using a deferred tool.

The functional loop is closed, but the current implementation cannot claim strong KV Cache gains. After the first selection, the serialized tool schemas retain only about 2% of the initial prefix because the registry outputs newly visible global tools before the scope-local `tool_search`. Repeating the same selection does not change the schemas again, so stability is not the problem; what is actually missing is a small mainline seam that keeps deferred tool schema ordering stable, not another search algorithm.

## Method

The benchmark reads a DSH-generated tool catalog supplied through `DSH_TOOL_CATALOG_PATH`, excludes `tool_search`, and deduplicates by name to obtain 40 first-party tool schemas. Each group retains five representative first-party targets — `bash`, `read`, `lsp`, `subagent`, and `web_search` — then adds deterministic MCP fixtures with original JSON Schema shapes. The 10-, 30-, 50-, and 100-tool groups contain 5/5, 15/15, 25/25, and 40/60 first-party/MCP tools, respectively.

Tool schema tokens are estimated by the repository's existing `TokenMeterService`. It uses a fixed estimate where every 4 characters cost about 1 token, plus structural overhead; this benchmark passes only tool schemas, without a system prompt or message history. The number is suitable for relative comparisons within this repository, but it is not equivalent to a model provider's tokenizer, bill, or `cache_read`/`cache_write` usage.

Exact name @1 searches with each tool's full callable name and checks the top result. Capability query @5 has fixed coverage of five first-party and five MCP targets, such as “read file contents,” “open a GitHub Issue,” and “query a Postgres database”; it checks whether the target appears in the top five. This metric validates the deterministic lexical-ranking baseline. It does not mean the model will generate the right query, nor does it cover ambiguous phrasing, synonym expansion, or multilingual recall.

Extra turns follow the Native Tool Mode contract: the model first calls `tool_search`, and only the next request can receive and call the full schema, so a deferred hit always adds 1 model turn. The KV Cache metric only compares the longest common character prefix between the initial tool schema list and the list after selecting one tool, then repeats the same selection to check whether the list is byte-for-byte stable; it is not a real model-provider cache hit rate.

## Results

| Tools | First-party / MCP | Full token | Initial token | Initial saving | Token after one selection | Saving after selection | Exact @1 | Capability @5 | Extra turns | Initial prefix retained | Repeat selection stable |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| 10 | 5 / 5 | 1,615 | 127 | 92.1% | 237 | 85.3% | 100% | 100% | 1 | 2.0% | Yes |
| 30 | 15 / 15 | 5,888 | 127 | 97.8% | 237 | 96.0% | 100% | 100% | 1 | 2.0% | Yes |
| 50 | 25 / 25 | 8,276 | 127 | 98.5% | 237 | 97.1% | 100% | 100% | 1 | 2.0% | Yes |
| 100 | 40 / 60 | 14,199 | 127 | 99.1% | 237 | 98.3% | 100% | 100% | 1 | 2.0% | Yes |

## Assessment

The scale benefit is sufficient to support submitting the experimental Native MVP. As tool count grows, the fixed `tool_search` schema becomes a smaller share; even after loading one tool, the 100-tool group still sends 98.3% fewer estimated tool-schema tokens. Exact-name and representative capability queries also do not decline when MCP tools are mixed in.

The 2% prefix-retention rate after the first selection is the most important negative result. The registry preserves global tool registration order and appends scope-local tools afterward, so the newly selected `read` appears before `tool_search`. The selected tool cannot be copied into a scope-local shadow to adjust its order: scope-local tools do not pass through the same global restriction, so doing so could bypass parent or permission filters. The ecosystem plugin should preserve its current non-escalation semantics, and the project team should decide whether to provide a small registry seam for stable schema ordering.

The conclusion therefore has two layers: on-demand discovery, execution, Session recovery, and forking do not require changing `agent-loop` or creating a new registry; if the goal includes real KV Cache hit gains, the project team must also provide stable tool schema ordering or a formal deferred contribution seam. That seam must change only the model-visible order, not tool resolution or the result of intersecting restrictions.

## Limitations

- No real model provider was called, so there is no end-to-end latency, real tokenizer, billed-token, or cache-read/write data.
- Capability queries are a fixed, manually selected English baseline used only to prevent obvious ranking regressions; they are not a complete retrieval-quality evaluation set.
- MCP tools use deterministic fixtures; the benchmark does not start a real MCP server or measure connection readiness, generation, or namespace loading.
- Results cover only the first Native Tool Mode version. Code Mode still needs a separate SDK search contract.

## Reproduction

```sh
DSH_TOOL_CATALOG_PATH=/path/to/deepseek-harness/docs/tool-catalog.md npm run benchmark
DSH_TOOL_CATALOG_PATH=/path/to/deepseek-harness/docs/tool-catalog.md npm run benchmark -- --json
npm test -- tests/benchmark.spec.ts
```

The implementation is in [`tests/benchmark.ts`](../../tests/benchmark.ts), and the regression check is in [`benchmark.spec.ts`](../../tests/benchmark.spec.ts). Real provider cache and latency data should be collected separately with an explicitly authorized API key in a paid e2e run. Record the provider, model, request count, cache bucket, and cost boundary in the report; do not overwrite this keyless baseline.
