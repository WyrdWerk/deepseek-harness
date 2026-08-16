# @deepseek-ai/dsh-tool-search

[English](README.md) | 中文

这是一个实验性的外部 Native Tool Mode 插件，为每个 agent（智能体）提供工具发现和渐进式 schema 披露。每个实时 agent 都会看到一个 scope-local 的 `tool_search` 工具，以及与 `alwaysVisible` 匹配的全局工具；其他符合条件的全局工具只有在 `tool_search` 选中后才可执行。该插件复用现有的 `ctx.tools.restrict()` seam，不改动 `agent-loop`。

这个私有仓库是该插件的事实源。该包尚未发布，也不作兼容性承诺。免密钥的 10/30/50/100 工具结果见[规模基准报告](docs/reports/2026-08-11-tool-search-benchmark.md)，决策与取舍见[设计记录](docs/design/2026-08-11-tool-search-progressive-disclosure.md)。

## 安装

该仓库为私有仓库，且该包未发布到 npm registry。请使用 Git 凭据和 pnpm `11.7.0`，直接从 GitHub 安装一个经过评审的 commit；每个需要使用工具搜索的 Profile 都要单独安装。DSH Profile 是 pnpm workspace 根目录，因此必须使用 `-w`：

```sh
dsh plugin --profile headless add -w github:dsh-external/dsh-tool-search#<reviewed-commit>
dsh plugin --profile web add -w github:dsh-external/dsh-tool-search#<reviewed-commit>
dsh --profile web --dump-config
```

该包的 `dsh.bundle.patch` 会同时加载运行时插件及其配套不变量。各 Profile 相互独立；安装到 `web` 不会启用 `headless`。启动该 Profile 前，`--dump-config` 必须显示 `tool-search` 和 `tool-search-invariant`。可使用 `dsh plugin --profile <profile> remove -w @deepseek-ai/dsh-tool-search` 从某个 Profile 中移除该 bundle。

## 配置

```yaml
- id: tool-search
  name: '@deepseek-ai/dsh-tool-search'
  config:
    alwaysVisible: [read_file, todo_*]
    maxResults: 5
    maxQueryChars: 512
```

| 配置键 | 默认值 | 含义 |
|---|---:|---|
| `alwaysVisible` | `[]` | 搜索前仍保持可见的全局工具名称模式。只有 `*` 是通配符，其他字符均按字面匹配。 |
| `maxResults` | `5` | 单次搜索允许返回的最大结果数。 |
| `maxQueryChars` | `512` | 裁剪后查询允许包含的最大 JavaScript 字符数。 |

边界值不是有效正整数、模式为空或两侧带空白，或者模式重复时，插件会在加载阶段失败。模型可以请求较小的 `limit`，取值从 `1` 到 `maxResults`，但不能提高部署边界。

## 选择与安全

搜索首先匹配精确的可调用名称，然后以确定性的 BM25 分数对名称和描述匹配结果排序，并以按码点排序的名称打破平局。每次成功扩展可见集时，系统都会写入一个 `tool-search/selection` 会话事件，其中包含裁剪后的查询和完整的已排序选中名称集合。后续事件必须是严格的累计超集；配套不变量会对实时会话和恢复会话强制执行事件形状与单调性规则。

每个 agent 都有独立的选择集合和 restriction。恢复或分叉的会话会在第一次请求前恢复最新选择。agent 已存在时安装该插件，也会为其挂载插件；卸载插件时，系统会移除 `tool_search`，并且只解除该插件自己的 restriction。

该插件绝不会扩大其他过滤器的范围。创建时已有的 restriction、父级／subagent 策略、scoped shadow 和其他 `ctx.tools.restrict()` 调用，在搜索后仍会取交集，因此某个工具即使被选中，只要另一个 restriction 仍拒绝它，结果就会显示 `unavailable`。初始目录只包含该 agent 已经可见的全局工具。MCP 工具等后注册的全局工具，只有在 agent 启动时拥有不受限制的全局视图时才会加入目录；如果 agent 启动时已受另一项 restriction，其符合条件的名称集合将保持初始状态。对于已知的后注册名称模式，`alwaysVisible` 是显式覆盖方式。

## 模型体验

### 工具 schema

#### 模型看到的内容

即使最初没有任何全局工具可见，每个受保护的 agent 也会看到以下描述；完整声明见 [`src/index.ts`](src/index.ts)。schema 包含 `query`（必填字符串）和 `limit`（可选整数，受配置边界限制）。该工具是 scope-local 工具，因此该插件的全局允许列表无法隐藏它。

##### 工具描述

```markdown
Search tools that are not currently visible. Describe the capability you need or name a tool exactly. Matching tools are loaded for the next model request; call them only after this result returns.
```

#### token 影响

每次请求都要承担固定 `tool_search` schema 与 `alwaysVisible` schema 的 token 成本。延后工具的 schema 在被选中前不占用请求 token。搜索结果会增加一条较小的保留历史记录；完整的已选中 schema 从下一次请求开始进入请求。

#### KV Cache 影响

只要已选集合与注册表不变，请求前缀就保持稳定；重复选择同一个工具不会改变 schema 列表。当前注册表先输出新可见的全局工具，再输出 scope-local 的 `tool_search`，因此首次选择后的序列化工具 schema 在[免密钥规模基准](docs/reports/2026-08-11-tool-search-benchmark.md)中只保留约 2% 的初始前缀。功能行为不受影响，但强 KV Cache 收益需要主线提供稳定 schema 顺序或正式的延后贡献 seam。工具注册、移除或插件生命周期变化也可能改变 schema 前缀。

### 搜索结果

#### 模型看到的内容

匹配结果采用下面的简短格式。没有匹配项时会渲染 `No matching tools found.`。规范值还包含裁剪后的 `query`、有序 `tools` 记录和 `remainingDeferred`。`loaded` 表示工具已变为可见，`already_loaded` 表示工具原本已可见，`unavailable` 表示另一项限制仍在阻止该工具。结果不会复制完整 schema；完整 schema 会通过下一次正常请求的请求头进入模型输入。

##### 结果示例

```markdown
Tool search results:
- <tool_name>: <loaded|already_loaded|unavailable>
Remaining deferred tools: <count>.
```

#### token 影响

结果大小受 `maxResults` 限制，并保留到压缩（compaction）发生。新选中的 schema 随后会增加其正常的固定单次请求成本。

#### KV Cache 影响

结果追加在可复用的历史前缀之后。如果至少有一个工具新被选中，后续请求会改变其 schema 前缀。

### 参数错误

#### 模型看到的内容

查询为空或过长、`limit` 超出范围或不是整数、调用时没有归属的实时 agent，以及嵌套的 Code Mode 分派，都会返回普通工具错误。失败的调用不会改变选择，也不会追加 `tool-search/selection`。

#### token 影响

错误结果作为一条普通工具结果进入历史并保留到压缩发生；它不会引入任何延后工具 schema。

#### KV Cache 影响

错误结果追加在已有前缀之后，不会改变工具 schema 前缀。相同失败如果再次发生，会像其他新增历史一样延长请求。

## 已知限制与延后工作

- **仅支持 Native Tool Mode。** 嵌套在 `run_code` 下的调用会明确失败；Code Mode 需要单独的 SDK／搜索传输契约。
- **仅支持词法搜索。** 精确名称、名称加权、描述和 BM25 在免密钥规模基准中达到精确名称 @1 与代表性能力查询 @5 的 100% 召回率；该小型固定语料不代表含糊查询、多语言查询或真实模型使用质量。向量嵌入和提供方原生搜索仍延后实现。
- **仅支持全局工具。** agent 作用域工具本就可见，绝不会进入延后目录。MCP 资源与提示词不属于工具注册表，需要各自的消费 seam。
- **保守的后注册工具策略。** 任何受限的初始全局视图都会固定符合条件的名称集合，因此后续注册即使无害，也可能无法被发现，除非 `alwaysVisible` 明确包含该名称。
- **不支持命名空间分组。** 选择单位仍是单个工具名称；大型 MCP 服务器可能需要按命名空间返回结果并加载。
- **尚无真实提供方缓存基准。** 当前 token 数使用仓库固定字符估算，KV Cache 只比较结构前缀；没有测真实 tokenizer、账单、cache bucket 或端到端延迟。
- **私有 Git 分发。** 该包尚未发布到 registry；安装时需要获得授权的 GitHub 访问权限、pnpm `11.7.0`、经过评审的 commit 以及兼容的 DSH Profile。

## 开发与验证

已检入的 `lib/` 输出无需重新构建即可安装。项目 `.npmrc` 只选择私有 `@deepseek-ai/*` scope；pnpm 11 会读取 `${NPM_TOKEN}` 认证映射，该映射来自受信任的用户级 `~/.npmrc`。设置 `NPM_TOKEN`，然后运行 `pnpm install --ignore-scripts` 和 `pnpm run check`。SDK 包固定使用经过评审的 `0.0.1-rc.2` 集合。不要把 DSH 源码 checkout 链接到本仓库。可选基准还要求用 `DSH_TOOL_CATALOG_PATH` 指向导出的 DSH 工具目录。`compat/` 目录是外部兼容性 fixture，不是源码开发依赖。
