/** Reproducible mixed first-party/MCP benchmark for progressive tool disclosure. */

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import TokenMeterService from '@deepseek-ai/dsh-token-meter'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as ToolSearch from '../src/index.ts'
import { TOOL_SEARCH_NAME } from '../src/index.ts'

const CATALOG_SIZES = [10, 30, 50, 100] as const
const REQUEST_CONFIG = { provider: 'benchmark', model: 'benchmark' } as const
const SIGNAL = new AbortController().signal
const FIRST_PARTY_TARGETS = [
  { name: 'bash', query: 'execute shell command' },
  { name: 'read', query: 'read file content' },
  { name: 'lsp', query: 'language server definition' },
  { name: 'subagent', query: 'delegate task to subagent' },
  { name: 'web_search', query: 'search the web' },
] as const
const MCP_TARGETS = [
  {
    name: 'mcp__github__create_issue',
    description: 'Open or create a GitHub issue in a repository with a title and body.',
    query: 'open github issue',
  },
  {
    name: 'mcp__slack__send_message',
    description: 'Send a Slack message to a channel or direct conversation.',
    query: 'send slack message',
  },
  {
    name: 'mcp__postgres__query_database',
    description: 'Query a Postgres database with read-only SQL and return rows.',
    query: 'query postgres database',
  },
  {
    name: 'mcp__sentry__list_errors',
    description: 'List recent Sentry errors and issue details for a project.',
    query: 'list sentry errors',
  },
  {
    name: 'mcp__google_drive__fetch_document',
    description: 'Fetch a Google Drive document by URL or file identifier.',
    query: 'fetch google drive document',
  },
] as const
const DISTRACTOR_SERVERS = [
  'airtable',
  'asana',
  'cloudflare',
  'datadog',
  'figma',
  'hubspot',
  'jira',
  'linear',
  'notion',
  'snowflake',
  'stripe',
  'vercel',
] as const
const DISTRACTOR_ACTIONS = [
  'create_comment',
  'deploy_service',
  'fetch_metrics',
  'get_record',
  'inspect_schema',
  'list_projects',
  'search_pages',
  'update_item',
] as const

/** One catalog-size result from the keyless benchmark. */
interface ToolSearchBenchmarkRow {
  /** Total mixed catalog size. */
  readonly catalogSize: number
  /** First-party schemas harvested from the generated catalog. */
  readonly firstPartyTools: number
  /** Deterministic MCP-style schemas in the mixed catalog. */
  readonly mcpTools: number
  /** Estimated tokens when every catalog schema is sent. */
  readonly fullSchemaTokens: number
  /** Estimated tokens in the initial `tool_search`-only request. */
  readonly initialSchemaTokens: number
  /** Estimated tokens after one deferred tool is selected. */
  readonly selectedSchemaTokens: number
  /** Percentage saved before the first selection. */
  readonly initialSavingsPercent: number
  /** Percentage saved after one selection. */
  readonly selectedSavingsPercent: number
  /** Exact callable-name recall at rank one across the whole catalog. */
  readonly exactRecallAt1Percent: number
  /** Fixed representative capability-query recall within five results. */
  readonly semanticRecallAt5Percent: number
  /** Additional model turns required before calling a deferred tool. */
  readonly extraModelTurns: number
  /** Longest common schema-prefix percentage from initial to one-selection state. */
  readonly initialToSelectedPrefixPercent: number
  /** Whether repeating the same selection leaves the schema list byte-identical. */
  readonly repeatedSelectionStable: boolean
}

/** Complete deterministic result plus its generated-catalog input count. */
export interface ToolSearchBenchmarkResult {
  /** Unique first-party tools available after excluding `tool_search`. */
  readonly sourceToolCount: number
  /** Results for the supported benchmark sizes. */
  readonly rows: readonly ToolSearchBenchmarkRow[]
}

interface SearchValue {
  readonly tools: readonly { readonly name: string }[]
}

/** Parse the model-facing schemas already harvested by the generated catalog. */
async function readFirstPartySchemas(): Promise<ToolSchema[]> {
  const configuredCatalog = process.env['DSH_TOOL_CATALOG_PATH']
  if (configuredCatalog === undefined || configuredCatalog.trim() === '') {
    throw new Error('tool-search benchmark: DSH_TOOL_CATALOG_PATH must name an exported DSH tool catalog')
  }
  const catalogUrl = pathToFileURL(configuredCatalog)
  const source = await readFile(catalogUrl, 'utf8')
  const pattern = /^### `([^`]+)`\n\n([^\n]+)\n\n```json\n([\s\S]*?)\n```$/gmu
  const unique = new Map<string, ToolSchema>()
  for (const match of source.matchAll(pattern)) {
    const [, name, description, rawParameters] = match
    if (name === undefined || description === undefined || rawParameters === undefined) continue
    if (name === TOOL_SEARCH_NAME || unique.has(name)) continue
    unique.set(name, {
      name,
      description,
      parameters: JSON.parse(rawParameters) as Record<string, unknown>,
    })
  }
  for (const target of FIRST_PARTY_TARGETS) {
    if (!unique.has(target.name)) throw new Error(`tool-search benchmark: generated catalog lacks ${target.name}`)
  }
  return [...unique.values()]
}

/** Create one realistic raw-JSON-Schema MCP tool surface. */
function mcpSchema(name: string, description: string): ToolSchema {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        input: {
          type: 'string',
          description: 'Provider-specific request or identifier.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return.',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['input'],
    },
  }
}

/** Build enough deterministic MCP-style tools for the largest mixed catalog. */
function mcpSchemas(): ToolSchema[] {
  const result = MCP_TARGETS.map(target => mcpSchema(target.name, target.description))
  for (const server of DISTRACTOR_SERVERS) {
    for (const action of DISTRACTOR_ACTIONS) {
      const words = action.replaceAll('_', ' ')
      result.push(mcpSchema(
        `mcp__${server}__${action}`,
        `${words[0]?.toUpperCase()}${words.slice(1)} in ${server} through its remote connector.`,
      ))
    }
  }
  return result
}

/** Keep representative targets present before filling in generated-catalog order. */
function prioritizeFirstParty(schemas: readonly ToolSchema[]): ToolSchema[] {
  const byName = new Map(schemas.map(schema => [schema.name, schema]))
  const preferred = FIRST_PARTY_TARGETS.map((target) => {
    const schema = byName.get(target.name)
    if (schema === undefined) throw new Error(`tool-search benchmark: missing ${target.name}`)
    return schema
  })
  return [...preferred, ...schemas.filter(schema => !FIRST_PARTY_TARGETS.some(
    target => target.name === schema.name,
  ))]
}

/** Pick a stable first-party/MCP mixture for one requested size. */
function corpus(
  size: number,
  firstParty: readonly ToolSchema[],
  mcp: readonly ToolSchema[],
): ToolSchema[] {
  const firstPartyCount = Math.min(firstParty.length, Math.ceil(size / 2))
  const mcpCount = size - firstPartyCount
  if (mcpCount > mcp.length) throw new Error(`tool-search benchmark: only ${mcp.length} MCP fixtures`)
  return [...firstParty.slice(0, firstPartyCount), ...mcp.slice(0, mcpCount)]
}

/** Register a detached catalog schema as a no-op benchmark fixture. */
function registerSchema(ctx: Context, schema: ToolSchema): void {
  ctx.tools.register({
    ...schema,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
      },
      render: () => [{ type: 'text', text: `ran:${schema.name}` }],
    },
    async execute() { return { ok: true } },
  })
}

/** Execute one scope-local search and return its canonical value. */
async function search(
  ctx: Context,
  agent: Agent,
  query: string,
  ordinal: number,
  limit: number,
): Promise<SearchValue> {
  const result: ToolExecutionResult = await ctx.tools.execute({
    callId: CallId(`tool-search-benchmark-${ordinal}`),
    name: TOOL_SEARCH_NAME,
    arguments: { query, limit },
    agent,
    signal: SIGNAL,
  })
  if (result.isError) throw new Error(`tool-search benchmark: ${result.error.message}`)
  return result.value as unknown as SearchValue
}

/** Estimate only the request schema pressure through the repository token meter. */
function schemaTokens(ctx: Context, agent: Agent, tools: ToolSchema[]): number {
  return ctx.tokenMeter.measure(agent.session, { config: REQUEST_CONFIG, tools }).totalTokens
}

/** Return a one-decimal percentage without binary-float noise in reports. */
function percent(numerator: number, denominator: number): number {
  return Number((100 * numerator / denominator).toFixed(1))
}

/** Count the common prefix of two serialized schema lists. */
function commonPrefixLength(left: string, right: string): number {
  const boundary = Math.min(left.length, right.length)
  let index = 0
  while (index < boundary && left[index] === right[index]) index += 1
  return index
}

/** Run one catalog size in an isolated context. */
async function runSize(schemas: readonly ToolSchema[]): Promise<ToolSearchBenchmarkRow> {
  const ctx = new Context()
  try {
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeterService)
    for (const schema of schemas) registerSchema(ctx, schema)
    await ctx.plugin(ToolSearch, { maxResults: 5 })

    const recallAgent = ctx.agentLoop.create(
      SessionId(`tool-search-benchmark-recall-${schemas.length}`),
      REQUEST_CONFIG,
    )
    let ordinal = 0
    let exactHits = 0
    for (const schema of schemas) {
      const result = await search(ctx, recallAgent, schema.name, ordinal += 1, 1)
      if (result.tools[0]?.name === schema.name) exactHits += 1
    }
    const semanticTargets = [
      ...FIRST_PARTY_TARGETS,
      ...MCP_TARGETS.map(({ name, query }) => ({ name, query })),
    ]
    let semanticHits = 0
    for (const target of semanticTargets) {
      const result = await search(ctx, recallAgent, target.query, ordinal += 1, 5)
      if (result.tools.some(tool => tool.name === target.name)) semanticHits += 1
    }

    const prefixAgent = ctx.agentLoop.create(
      SessionId(`tool-search-benchmark-prefix-${schemas.length}`),
      REQUEST_CONFIG,
    )
    const fullSchemas = ctx.tools.schemas()
    const initialSchemas = ctx.tools.schemas(prefixAgent)
    const fullSchemaTokens = schemaTokens(ctx, prefixAgent, fullSchemas)
    const initialSchemaTokens = schemaTokens(ctx, prefixAgent, initialSchemas)
    await search(ctx, prefixAgent, 'read', ordinal += 1, 1)
    const selectedSchemas = ctx.tools.schemas(prefixAgent)
    const selectedSchemaTokens = schemaTokens(ctx, prefixAgent, selectedSchemas)
    const selectedSerialized = JSON.stringify(selectedSchemas)
    await search(ctx, prefixAgent, 'read', ordinal += 1, 1)
    const repeatedSerialized = JSON.stringify(ctx.tools.schemas(prefixAgent))
    const initialSerialized = JSON.stringify(initialSchemas)

    return {
      catalogSize: schemas.length,
      firstPartyTools: schemas.filter(schema => !schema.name.startsWith('mcp__')).length,
      mcpTools: schemas.filter(schema => schema.name.startsWith('mcp__')).length,
      fullSchemaTokens,
      initialSchemaTokens,
      selectedSchemaTokens,
      initialSavingsPercent: percent(fullSchemaTokens - initialSchemaTokens, fullSchemaTokens),
      selectedSavingsPercent: percent(fullSchemaTokens - selectedSchemaTokens, fullSchemaTokens),
      exactRecallAt1Percent: percent(exactHits, schemas.length),
      semanticRecallAt5Percent: percent(semanticHits, semanticTargets.length),
      extraModelTurns: 1,
      initialToSelectedPrefixPercent: percent(
        commonPrefixLength(initialSerialized, selectedSerialized),
        initialSerialized.length,
      ),
      repeatedSelectionStable: selectedSerialized === repeatedSerialized,
    }
  } finally {
    await ctx.fiber.dispose()
  }
}

/**
 * Run the keyless 10/30/50/100-tool progressive-disclosure benchmark.
 * @param sourceSchemas - optional keyless fixture; omit to read `DSH_TOOL_CATALOG_PATH`.
 * @returns deterministic result rows derived from first-party schemas and MCP fixtures.
 */
export async function runToolSearchBenchmark(
  sourceSchemas?: readonly ToolSchema[],
): Promise<ToolSearchBenchmarkResult> {
  const rawFirstParty = sourceSchemas === undefined ? await readFirstPartySchemas() : [...sourceSchemas]
  const firstParty = prioritizeFirstParty(rawFirstParty)
  const mcp = mcpSchemas()
  const rows: ToolSearchBenchmarkRow[] = []
  for (const size of CATALOG_SIZES) rows.push(await runSize(corpus(size, firstParty, mcp)))
  return { sourceToolCount: rawFirstParty.length, rows }
}

/**
 * Format benchmark rows as a compact Markdown table for reports and issue comments.
 * @param result - completed deterministic benchmark.
 * @returns Markdown with the input count and one row per catalog size.
 */
export function formatToolSearchBenchmarkMarkdown(result: ToolSearchBenchmarkResult): string {
  const lines = [
    `First-party source schemas: ${result.sourceToolCount}`,
    '',
    '| Tools | First-party / MCP | Full tokens | Initial tokens | Initial saved | After one load | Saved after load | Exact @1 | Semantic @5 | Extra turns | Initial prefix kept | Repeat stable |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |',
  ]
  for (const row of result.rows) {
    lines.push(`| ${row.catalogSize} | ${row.firstPartyTools} / ${row.mcpTools} | ${row.fullSchemaTokens} | ${row.initialSchemaTokens} | ${row.initialSavingsPercent}% | ${row.selectedSchemaTokens} | ${row.selectedSavingsPercent}% | ${row.exactRecallAt1Percent}% | ${row.semanticRecallAt5Percent}% | ${row.extraModelTurns} | ${row.initialToSelectedPrefixPercent}% | ${row.repeatedSelectionStable ? 'yes' : 'no'} |`)
  }
  return `${lines.join('\n')}\n`
}
