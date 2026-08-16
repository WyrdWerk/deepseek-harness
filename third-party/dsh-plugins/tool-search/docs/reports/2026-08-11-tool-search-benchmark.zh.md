# `dsh-tool-search` 规模基准报告

[English](2026-08-11-tool-search-benchmark.md) | 中文

> 快照时间：2026-08-11（Asia/Shanghai）。结果来自当前本地工作树，使用免密钥、可重复运行的仓库内基准；没有调用收费模型 API。

## 结论

`dsh-tool-search` 在 10、30、50、100 个混合工具下，把初始工具 schema 的估算 token 从 1,615–14,199 降到固定的 127，节省 92.1%–99.1%。选择一个工具后仍节省 85.3%–98.3%。全部工具的精确名称搜索 @1 和 10 个代表性能力查询 @5 都达到 100%，代价是使用延后工具前固定增加 1 次模型轮次。

功能闭环已经成立，但当前实现不能宣称获得了强 KV Cache 收益。首次选择后，序列化工具 schema 只保留约 2% 的初始前缀，因为注册表先输出新可见的全局工具，再输出 scope-local 的 `tool_search`。重复同一次选择不会继续改变 schema，因此稳定性没有问题；真正缺的是一个保持延后工具 schema 顺序稳定的最小主线 seam，而不是另一套搜索算法。

## 方法

基准读取通过 `DSH_TOOL_CATALOG_PATH` 提供的 DSH 生成工具目录，排除 `tool_search` 并按名称去重，得到 40 个第一方工具 schema。每组保留 `bash`、`read`、`lsp`、`subagent`、`web_search` 五个代表性第一方目标，再加入带原始 JSON Schema 形状的确定性 MCP fixture。10、30、50、100 工具组分别由 5/5、15/15、25/25、40/60 个第一方／MCP 工具组成。

工具 schema token 由仓库现有 `TokenMeterService` 估算。该服务使用固定的每 4 个字符约 1 个 token 加结构开销；本基准只传工具 schema，不加入 system prompt 或历史消息。这个数字适合做同一仓库内的相对对照，不等同于模型提供方的 tokenizer、账单或 `cache_read`／`cache_write` 用量。

精确名称 @1 会对每个工具用完整可调用名称搜索，并检查第一名。能力查询 @5 固定覆盖五个第一方目标和五个 MCP 目标，例如“读取文件内容”“打开 GitHub Issue”“查询 Postgres 数据库”；它检查目标是否进入前五名。该指标验证确定性词法排序基线，不代表模型一定会生成正确查询，也不覆盖含糊表达、同义词扩展或多语言召回。

额外轮次按 Native Tool Mode 契约计数：模型先调用 `tool_search`，下一次请求才能获得并调用完整 schema，因此延后命中固定增加 1 次模型轮次。KV Cache 指标只比较初始工具 schema 列表与选择一个工具后的最长公共字符前缀，并重复同一次选择检查列表是否逐字节稳定；它不是模型提供方真实缓存命中率。

## 结果

| 工具数 | 第一方 / MCP | 全量 token | 初始 token | 初始节省 | 选择一个后 token | 选择后节省 | 精确 @1 | 能力 @5 | 额外轮次 | 初始前缀保留 | 重复选择稳定 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|
| 10 | 5 / 5 | 1,615 | 127 | 92.1% | 237 | 85.3% | 100% | 100% | 1 | 2.0% | 是 |
| 30 | 15 / 15 | 5,888 | 127 | 97.8% | 237 | 96.0% | 100% | 100% | 1 | 2.0% | 是 |
| 50 | 25 / 25 | 8,276 | 127 | 98.5% | 237 | 97.1% | 100% | 100% | 1 | 2.0% | 是 |
| 100 | 40 / 60 | 14,199 | 127 | 99.1% | 237 | 98.3% | 100% | 100% | 1 | 2.0% | 是 |

## 判断

规模收益足以支持提交实验性 Native MVP。工具越多，固定 `tool_search` schema 的占比越低；即使只加载一个工具，100 工具组仍少发送 98.3% 的工具 schema 估算 token。精确名称和代表性能力查询也没有因为混入 MCP 工具而下降。

首次选择的 2% 前缀保留率是当前最重要的负面结果。注册表保持全局工具的注册顺序，并在其后追加 scope-local 工具，所以新选中的 `read` 会出现在 `tool_search` 前面。不能把选中工具复制为 scope-local shadow 来调整顺序：scope-local 工具不经过同一套全局 restriction，这样可能绕过父级或权限过滤器。生态插件应保留当前非升权语义，由项目组决定是否为稳定 schema 顺序提供最小注册表 seam。

因此，本轮结论分为两层：按需发现、执行、Session 恢复和分叉不需要修改 `agent-loop` 或新建注册表；如果目标包含真实 KV Cache 命中收益，项目组还需要补稳定的工具 schema 排序或正式的 deferred contribution seam。该 seam 必须只改变模型可见顺序，不能改变工具解析和 restriction 取交集的结果。

## 限制

- 没有调用真实模型提供方，因此没有端到端延迟、真实 tokenizer、账单 token 或缓存读写数据。
- 能力查询是固定、人工选择的英文基线，只用于阻止明显排序退化；它不是完整检索质量评测集。
- MCP 工具使用确定性 fixture，没有启动真实 MCP server，也没有测连接 readiness、generation 或命名空间加载。
- 结果只覆盖第一版 Native Tool Mode。Code Mode 仍需要独立的 SDK 搜索契约。

## 复现

```sh
DSH_TOOL_CATALOG_PATH=/path/to/deepseek-harness/docs/tool-catalog.md npm run benchmark
DSH_TOOL_CATALOG_PATH=/path/to/deepseek-harness/docs/tool-catalog.md npm run benchmark -- --json
npm test -- tests/benchmark.spec.ts
```

实现位于 [`tests/benchmark.ts`](../../tests/benchmark.ts)，回归检查位于 [`benchmark.spec.ts`](../../tests/benchmark.spec.ts)。若要补真实提供方缓存和延迟数据，应单独使用明确授权的 API 密钥运行收费 e2e，并把提供方、模型、请求次数、cache bucket 和费用边界写进报告，不能覆盖本免密钥基线。
