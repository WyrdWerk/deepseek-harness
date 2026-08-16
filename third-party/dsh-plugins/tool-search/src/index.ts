/**
 * Experimental Native Tool Mode progressive disclosure: each agent keeps a
 * small global tool surface plus a scope-local `tool_search` discovery tool.
 * Search selections are durable whole snapshots and widen only this plugin's
 * restriction, so an independent parent/tool-filter restriction still wins.
 * @module @deepseek-ai/dsh-tool-search
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  compareToolNames,
  decodeToolSearchSelection,
  type ToolSearchSelection,
} from './selection.ts'

export type { ToolSearchSelection } from './selection.ts'

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    /**
     * Whole per-agent selected-tool snapshot. Each later event is a strict
     * superset; the latest event restores progressive disclosure on resume or fork.
     */
    'tool-search/selection': ToolSearchSelection
  }
}

/** Cordis plugin name. */
export const name = 'tool-search'
/** Services required to attach one search surface to every live agent. */
export const inject = ['agents', 'tools']

/** Model-facing discovery tool name. */
export const TOOL_SEARCH_NAME = 'tool_search'

/** Per-agent search policy. */
export interface Config {
  /** `*`-wildcard global tool-name patterns that remain directly visible before search. */
  alwaysVisible?: string[]
  /** Maximum tools one search call may return and attempt to load (default 5). */
  maxResults?: number
  /** Maximum trimmed query length in JavaScript characters (default 512). */
  maxQueryChars?: number
}

/** Schemastery validation and defaults for {@link Config}. */
export const Config: z<Config> = z.object({
  alwaysVisible: z.array(z.string()).default([]),
  maxResults: z.number().default(5),
  maxQueryChars: z.number().default(512),
})

const RESULT_STATUSES = ['loaded', 'already_loaded', 'unavailable'] as const
type ResultStatus = typeof RESULT_STATUSES[number]

/** Resolved load-time policy. */
interface ResolvedConfig {
  readonly alwaysVisible: readonly RegExp[]
  readonly maxResults: number
  readonly maxQueryChars: number
}

/** Searchable global tool schema plus precomputed lexical fields. */
interface CatalogEntry {
  readonly schema: ToolSchema
  readonly normalizedName: string
  readonly normalizedDescription: string
  readonly tokens: readonly string[]
  readonly frequencies: ReadonlyMap<string, number>
}

/** One ranked catalog result. */
interface RankedEntry {
  readonly entry: CatalogEntry
  readonly score: number
}

/** One agent's owned restriction and durable selection intent. */
interface AgentState {
  readonly agent: Agent
  readonly admitFutureGlobalTools: boolean
  readonly eligibleNames: Set<string>
  readonly selectedNames: Set<string>
  catalog: Map<string, CatalogEntry>
  allowedNames: string[]
  liftRestriction: (() => void) | undefined
  removeSearchTool: (() => void) | undefined
}

/** Normalize user/catalog text for deterministic lexical comparison. */
function normalizeText(value: string): string {
  return value.normalize('NFKC').toLowerCase()
}

/** Tokenize Unicode letters and numbers; punctuation and identifier separators form boundaries. */
function tokenize(value: string): string[] {
  return normalizeText(value).match(/[\p{L}\p{N}]+/gu) ?? []
}

/** Build a term-frequency map without retaining duplicate token strings. */
function frequencies(tokens: readonly string[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const token of tokens) result.set(token, (result.get(token) ?? 0) + 1)
  return result
}

/** Convert a detached model-facing schema to its searchable representation. */
function catalogEntry(schema: ToolSchema): CatalogEntry {
  const normalizedName = normalizeText(schema.name)
  const normalizedDescription = normalizeText(schema.description)
  const tokens = [...tokenize(schema.name), ...tokenize(schema.description)]
  return {
    schema,
    normalizedName,
    normalizedDescription,
    tokens,
    frequencies: frequencies(tokens),
  }
}

/** BM25 contribution for one query term and one catalog entry. */
function bm25(
  termFrequency: number,
  documentFrequency: number,
  documentLength: number,
  averageDocumentLength: number,
  documentCount: number,
): number {
  const k1 = 1.2
  const b = 0.75
  const inverseDocumentFrequency = Math.log(
    1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5),
  )
  const normalizedLength = documentLength / averageDocumentLength
  return inverseDocumentFrequency * (
    termFrequency * (k1 + 1)
    / (termFrequency + k1 * (1 - b + b * normalizedLength))
  )
}

/** Rank name/description matches, forcing exact callable-name terms ahead of BM25-only matches. */
function rankCatalog(query: string, entries: readonly CatalogEntry[]): RankedEntry[] {
  if (entries.length === 0) return []
  const normalizedQuery = normalizeText(query)
  const queryTokens = [...new Set(tokenize(query))]
  const rawTerms = new Set(normalizedQuery.split(/\s+/u).filter(Boolean))
  const documentFrequency = new Map<string, number>()
  for (const term of queryTokens) {
    documentFrequency.set(term, entries.filter(entry => entry.frequencies.has(term)).length)
  }
  const averageDocumentLength = Math.max(
    1,
    entries.reduce((total, entry) => total + entry.tokens.length, 0) / entries.length,
  )
  const ranked: RankedEntry[] = []
  for (const entry of entries) {
    let score = 0
    if (entry.normalizedName === normalizedQuery) score += 1_000_000
    if (rawTerms.has(entry.normalizedName)) score += 100_000
    if (normalizedQuery.length > 0 && entry.normalizedName.includes(normalizedQuery)) score += 1_000
    if (normalizedQuery.length > 0 && entry.normalizedDescription.includes(normalizedQuery)) score += 100
    const nameTokens = new Set(tokenize(entry.schema.name))
    for (const term of queryTokens) {
      const termFrequency = entry.frequencies.get(term) ?? 0
      if (termFrequency > 0) {
        score += bm25(
          termFrequency,
          documentFrequency.get(term) as number,
          entry.tokens.length,
          averageDocumentLength,
          entries.length,
        )
      }
      if (nameTokens.has(term)) score += 50
      if (entry.normalizedName.startsWith(term)) score += 20
    }
    if (score > 0) ranked.push({ entry, score })
  }
  return ranked.sort((left, right) =>
    right.score - left.score || compareToolNames(left.entry.schema.name, right.entry.schema.name),
  )
}

/** Compile a `*` wildcard while treating every other regexp character literally. */
function wildcard(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

/** Resolve one positive safe-integer config field. */
function positiveInteger(field: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error(`tool-search: ${field} must be a positive safe integer, got ${String(resolved)}`)
  }
  return resolved
}

/** Resolve and validate configuration once at plugin load. */
function resolveConfig(config: Config): ResolvedConfig {
  const patterns = config.alwaysVisible ?? []
  const seen = new Set<string>()
  const alwaysVisible = patterns.map((pattern) => {
    if (pattern.length === 0 || pattern.trim() !== pattern) {
      throw new Error('tool-search: alwaysVisible entries must be non-empty and have no surrounding whitespace')
    }
    if (seen.has(pattern)) {
      throw new Error(`tool-search: alwaysVisible repeats pattern ${JSON.stringify(pattern)}`)
    }
    seen.add(pattern)
    return wildcard(pattern)
  })
  return {
    alwaysVisible,
    maxResults: positiveInteger('maxResults', config.maxResults, 5),
    maxQueryChars: positiveInteger('maxQueryChars', config.maxQueryChars, 512),
  }
}

/** Latest durable whole selection, or an empty set before the first search expansion. */
function restoreSelection(agent: Agent): Set<string> {
  for (const event of [...agent.session.events].reverse()) {
    if (event.type !== 'tool-search/selection') continue
    const snapshot = decodeToolSearchSelection(event.data, 'tool-search/selection')
    return new Set(snapshot.selected)
  }
  return new Set()
}

/** Render a compact result; full schemas arrive through the next request header. */
function renderResult(value: {
  readonly tools: readonly { readonly name: string; readonly status: ResultStatus }[]
  readonly remainingDeferred: number
}): string {
  if (value.tools.length === 0) return 'No matching tools found.'
  const lines = value.tools.map(tool => `- ${tool.name}: ${tool.status}`)
  return `Tool search results:\n${lines.join('\n')}\nRemaining deferred tools: ${value.remainingDeferred}.`
}

/**
 * Install progressive disclosure for every current and future agent.
 * @param ctx - plugin context carrying agent and tool registries.
 * @param config - visibility patterns and per-call bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const states = new Map<Agent, AgentState>()
  let registryMutationDepth = 0

  /** Run a registry mutation without treating its own `tools/change` as an external update. */
  function mutateRegistry<T>(operation: () => T): T {
    registryMutationDepth += 1
    try {
      return operation()
    } finally {
      registryMutationDepth -= 1
    }
  }

  /** Current global schemas keyed by callable name. */
  function globalSchemas(): Map<string, ToolSchema> {
    return new Map(ctx.tools.schemas().map(schema => [schema.name, schema]))
  }

  /** Refresh the safe searchable catalog without exposing names hidden at agent creation. */
  function refreshCatalog(state: AgentState): void {
    const globals = globalSchemas()
    if (state.admitFutureGlobalTools) {
      for (const toolName of globals.keys()) state.eligibleNames.add(toolName)
    }
    state.catalog = new Map(
      [...globals]
        .filter(([toolName]) => state.eligibleNames.has(toolName))
        .map(([toolName, schema]) => [toolName, catalogEntry(schema)]),
    )
  }

  /** Names this plugin allows; independent restrictions still intersect afterward. */
  function desiredAllowedNames(state: AgentState): string[] {
    const globalNames = new Set(globalSchemas().keys())
    return [...globalNames]
      .filter(toolName => state.selectedNames.has(toolName)
        || resolved.alwaysVisible.some(pattern => pattern.test(toolName)))
      .sort(compareToolNames)
  }

  /** Replace only this plugin's restriction, installing before lifting to avoid an open interval. */
  function refreshRestriction(state: AgentState): void {
    const nextNames = desiredAllowedNames(state)
    if (state.liftRestriction !== undefined
      && nextNames.length === state.allowedNames.length
      && nextNames.every((toolName, index) => toolName === state.allowedNames[index])) return
    const liftNext = mutateRegistry(() => state.agent.ctx.tools.restrict({ allow: nextNames }))
    const liftPrevious = state.liftRestriction
    state.liftRestriction = liftNext
    state.allowedNames = nextNames
    if (liftPrevious !== undefined) mutateRegistry(liftPrevious)
  }

  /** Search and commit a cumulative selection for one agent. */
  function search(
    state: AgentState,
    rawQuery: string,
    requestedLimit: number | undefined,
    caller: Agent | undefined,
    parent: symbol | undefined,
  ): { query: string; tools: { name: string; status: ResultStatus }[]; remainingDeferred: number } {
    if (caller !== state.agent) throw new Error('tool_search requires its owning live agent')
    if (parent !== undefined) {
      throw new Error('tool_search supports Native Tool Mode only in this experimental version')
    }
    const query = rawQuery.trim()
    if (query.length === 0) throw new Error('tool_search query must not be blank')
    if (query.length > resolved.maxQueryChars) {
      throw new Error(`tool_search query exceeds maxQueryChars (${resolved.maxQueryChars})`)
    }
    const limit = requestedLimit ?? resolved.maxResults
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > resolved.maxResults) {
      throw new Error(`tool_search limit must be an integer from 1 to ${resolved.maxResults}`)
    }
    refreshCatalog(state)
    const matches = rankCatalog(query, [...state.catalog.values()]).slice(0, limit)
    const visibleBefore = new Set(ctx.tools.schemas(state.agent).map(schema => schema.name))
    const previousSelection = new Set(state.selectedNames)
    for (const { entry } of matches) state.selectedNames.add(entry.schema.name)
    const selectionChanged = state.selectedNames.size !== previousSelection.size
    if (selectionChanged) {
      try {
        refreshRestriction(state)
        state.agent.session.append('tool-search/selection', {
          query,
          selected: [...state.selectedNames].sort(compareToolNames),
        })
      } catch (error: unknown) {
        state.selectedNames.clear()
        for (const toolName of previousSelection) state.selectedNames.add(toolName)
        refreshRestriction(state)
        throw error
      }
    }
    const visibleAfter = new Set(ctx.tools.schemas(state.agent).map(schema => schema.name))
    const tools = matches.map(({ entry }): { name: string; status: ResultStatus } => ({
      name: entry.schema.name,
      status: !visibleAfter.has(entry.schema.name)
        ? 'unavailable'
        : visibleBefore.has(entry.schema.name) ? 'already_loaded' : 'loaded',
    }))
    return {
      query,
      tools,
      remainingDeferred: [...state.catalog.keys()]
        .filter(toolName => !visibleAfter.has(toolName)).length,
    }
  }

  /** Attach search and the initial restriction to one exact live agent. */
  function install(agent: Agent): void {
    if (states.has(agent)) return
    const globals = globalSchemas()
    const eligibleNames = new Set<string>()
    let everyGlobalVisible = true
    for (const toolName of globals.keys()) {
      if (ctx.tools.get(toolName, agent) === ctx.tools.get(toolName)) eligibleNames.add(toolName)
      else everyGlobalVisible = false
    }
    const state: AgentState = {
      agent,
      admitFutureGlobalTools: everyGlobalVisible,
      eligibleNames,
      selectedNames: restoreSelection(agent),
      catalog: new Map(),
      allowedNames: [],
      liftRestriction: undefined,
      removeSearchTool: undefined,
    }
    states.set(agent, state)
    try {
      refreshCatalog(state)
      state.removeSearchTool = mutateRegistry(() => agent.ctx.tools.register(defineTool({
        name: TOOL_SEARCH_NAME,
        description:
          'Search tools that are not currently visible. Describe the capability you need or name a tool exactly. '
          + 'Matching tools are loaded for the next model request; call them only after this result returns.',
        parameters: {
          query: {
            type: 'string',
            required: true,
            description: `Capability or exact tool name to find (maximum ${resolved.maxQueryChars} characters).`,
          },
          limit: {
            type: 'integer',
            description: `Maximum matches to load, from 1 to ${resolved.maxResults}.`,
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              query: { type: 'string', required: true },
              tools: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string', required: true },
                    status: { type: 'string', required: true, enum: [...RESULT_STATUSES] },
                  },
                },
              },
              remainingDeferred: { type: 'integer', required: true },
            },
          },
          render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
        },
        presentCall: args => ({
          card: 'generic',
          title: 'Search tools',
          kind: 'search',
          rawInput: args.query,
        }),
        presentResult: (_args, result) => ({
          card: 'generic',
          title: result.isError ? 'Tool search failed' : 'Tool search results',
          content: result.content,
        }),
        execute: (args, exec) => Promise.resolve(search(
          state,
          args.query,
          args.limit,
          exec.agent,
          exec.parent,
        )),
      })))
      refreshRestriction(state)
    } catch (error: unknown) {
      states.delete(agent)
      mutateRegistry(() => { state.removeSearchTool?.() })
      throw error
    }
  }

  /** Lift every registration owned for one exact agent. */
  function uninstall(agent: Agent): void {
    const state = states.get(agent)
    if (state === undefined) return
    states.delete(agent)
    mutateRegistry(() => {
      state.liftRestriction?.()
      state.removeSearchTool?.()
    })
  }

  ctx.on('agent/created', ({ agent }) => { install(agent) })
  ctx.on('agent/disposed', ({ agent }) => { uninstall(agent) })
  ctx.on('tools/change', () => {
    if (registryMutationDepth > 0) return
    for (const state of states.values()) {
      refreshCatalog(state)
      refreshRestriction(state)
    }
  })
  for (const agent of ctx.agents.list()) install(agent)
  ctx.effect(() => () => {
    for (const agent of states.keys()) uninstall(agent)
  }, 'tool-search: per-agent registrations')
}

/** Session event type retained for consumers that need an exact discriminated event. */
export type ToolSearchSelectionEvent = SessionEvent<'tool-search/selection'>
