import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId, type JsonValue, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  defineContentToolFixture,
  type ToolExecutionResult,
  type ToolExecutionToken,
  type ToolRunContext,
} from '@deepseek-ai/dsh-tools'
import * as ToolSearch from '../src/index.ts'
import { TOOL_SEARCH_NAME, type Config } from '../src/index.ts'

const contexts: Context[] = []
const signal = new AbortController().signal
let callOrdinal = 0

afterEach(async () => {
  callOrdinal = 0
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function fixture(name: string, description: string) {
  return defineContentToolFixture({
    name,
    description,
    parameters: {},
    async execute() { return [{ type: 'text', text: `ran:${name}` }] },
  })
}

async function harness(config: Config = {}): Promise<{ ctx: Context; plugin: Fiber }> {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const plugin = await ctx.plugin(ToolSearch, config)
  return { ctx, plugin }
}

function createAgent(ctx: Context, id: string): Agent {
  return ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
}

async function execute(
  ctx: Context,
  agent: Agent,
  name: string,
  args: JsonValue,
  parent?: ToolExecutionToken,
): Promise<ToolExecutionResult> {
  callOrdinal += 1
  return await ctx.tools.execute({
    callId: CallId(`tool-search-${callOrdinal}`),
    name,
    arguments: args,
    agent,
    signal,
    ...parent === undefined ? {} : { parent },
  })
}

function schemaNames(ctx: Context, agent: Agent): string[] {
  return ctx.tools.schemas(agent).map(schema => schema.name).sort()
}

function selectionEvents(agent: Agent): SessionEvent<'tool-search/selection'>[] {
  return agent.session.events.filter(
    (event): event is SessionEvent<'tool-search/selection'> => event.type === 'tool-search/selection',
  )
}

describe('Native Tool Mode progressive disclosure', () => {
  it('hides deferred globals, loads an exact-name match, and logs the cumulative selection', async () => {
    const { ctx } = await harness({ alwaysVisible: ['read_*'] })
    ctx.tools.register(fixture('read_file', 'Read a local file'))
    ctx.tools.register(fixture('search_database', 'Find rows in a database'))
    const agent = createAgent(ctx, 'exact')

    expect(schemaNames(ctx, agent)).toEqual(['read_file', TOOL_SEARCH_NAME])
    await expect(execute(ctx, agent, 'search_database', {})).resolves.toMatchObject({
      isError: true,
      error: { info: { code: 'UNKNOWN_TOOL' } },
    })

    const found = await execute(ctx, agent, TOOL_SEARCH_NAME, {
      query: 'search_database',
      limit: 1,
    })
    expect(found).toMatchObject({
      isError: false,
      value: {
        query: 'search_database',
        tools: [{ name: 'search_database', status: 'loaded' }],
        remainingDeferred: 0,
      },
    })
    expect(schemaNames(ctx, agent)).toEqual(['read_file', 'search_database', TOOL_SEARCH_NAME])
    await expect(execute(ctx, agent, 'search_database', {})).resolves.toMatchObject({ isError: false })
    expect(selectionEvents(agent).map(event => event.data)).toEqual([{
      query: 'search_database',
      selected: ['search_database'],
    }])
  })

  it('ranks exact callable names ahead of broad description matches and keeps stable ties', async () => {
    const { ctx } = await harness({ maxResults: 3 })
    ctx.tools.register(fixture('deploy', 'Perform a deployment'))
    ctx.tools.register(fixture('alpha_ship', 'Deploy and release an application'))
    ctx.tools.register(fixture('beta_ship', 'Deploy and release an application'))
    const agent = createAgent(ctx, 'ranking')

    const exact = await execute(ctx, agent, TOOL_SEARCH_NAME, { query: 'deploy', limit: 1 })
    expect(exact.isError ? undefined : exact.value).toMatchObject({
      tools: [{ name: 'deploy', status: 'loaded' }],
    })
    const tied = await execute(ctx, agent, TOOL_SEARCH_NAME, { query: 'release application', limit: 2 })
    expect(tied.isError ? undefined : tied.value).toMatchObject({
      tools: [
        { name: 'alpha_ship', status: 'loaded' },
        { name: 'beta_ship', status: 'loaded' },
      ],
    })
    expect(selectionEvents(agent).at(-1)?.data.selected).toEqual(['alpha_ship', 'beta_ship', 'deploy'])
  })

  it('keeps selections independent and restores them from a seeded fork', async () => {
    const { ctx } = await harness()
    ctx.tools.register(fixture('lookup_customer', 'Find one customer account'))
    const first = createAgent(ctx, 'first')
    const second = createAgent(ctx, 'second')

    await execute(ctx, first, TOOL_SEARCH_NAME, { query: 'customer' })
    expect(schemaNames(ctx, first)).toContain('lookup_customer')
    expect(schemaNames(ctx, second)).not.toContain('lookup_customer')

    const fork: AgentHandle = await ctx.agents.create({
      sessionId: SessionId('fork'),
      seed: first.session.events,
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(schemaNames(ctx, fork.agent)).toContain('lookup_customer')
    await fork.dispose()
  })

  it('intersects with a creation-time filter and never makes its denied tool searchable', async () => {
    const { ctx } = await harness()
    ctx.tools.register(fixture('public_lookup', 'Find public records'))
    ctx.tools.register(fixture('secret_lookup', 'Find private secret records'))
    const handle = await ctx.agents.create({
      sessionId: SessionId('filtered'),
      agentOptions: { provider: 'mock', model: 'mock' },
      setup(agentCtx) { agentCtx.tools.restrict({ deny: ['secret_lookup'] }) },
    })

    const result = await execute(ctx, handle.agent, TOOL_SEARCH_NAME, { query: 'private secret' })
    expect(result.isError ? undefined : result.value).toEqual({
      query: 'private secret',
      tools: [],
      remainingDeferred: 1,
    })
    expect(schemaNames(ctx, handle.agent)).toEqual([TOOL_SEARCH_NAME])
    await handle.dispose()
  })

  it('admits late global tools only for an agent whose initial global view was unrestricted', async () => {
    const { ctx } = await harness()
    ctx.tools.register(fixture('blocked', 'Existing blocked capability'))
    const open = createAgent(ctx, 'open')
    const filtered = await ctx.agents.create({
      sessionId: SessionId('filtered-late'),
      agentOptions: { provider: 'mock', model: 'mock' },
      setup(agentCtx) { agentCtx.tools.restrict({ deny: ['blocked'] }) },
    })
    ctx.tools.register(fixture('mcp_late', 'Late MCP-style remote capability'))

    const openResult = await execute(ctx, open, TOOL_SEARCH_NAME, { query: 'mcp_late' })
    expect(openResult.isError ? undefined : openResult.value).toMatchObject({
      tools: [{ name: 'mcp_late', status: 'loaded' }],
    })
    const filteredResult = await execute(ctx, filtered.agent, TOOL_SEARCH_NAME, { query: 'mcp_late' })
    expect(filteredResult.isError ? undefined : filteredResult.value).toMatchObject({ tools: [] })
    expect(schemaNames(ctx, filtered.agent)).not.toContain('mcp_late')
    await filtered.dispose()
  })

  it('fails loud on invalid calls and rejects nested Code Mode dispatch', async () => {
    const { ctx } = await harness({ maxResults: 2, maxQueryChars: 8 })
    ctx.tools.register(fixture('probe', 'Probe a target'))
    const agent = createAgent(ctx, 'invalid')

    for (const args of [
      { query: '   ' },
      { query: '123456789' },
      { query: 'probe', limit: 0 },
      { query: 'probe', limit: 3 },
      { query: 'probe', limit: 1.5 },
    ]) {
      await expect(execute(ctx, agent, TOOL_SEARCH_NAME, args)).resolves.toMatchObject({ isError: true })
    }
    const nested = await execute(
      ctx,
      agent,
      TOOL_SEARCH_NAME,
      { query: 'probe' },
      Symbol('parent') as ToolExecutionToken,
    )
    expect(nested.isError ? nested.error.message : '').toMatch(/Native Tool Mode only/)
    expect(selectionEvents(agent)).toEqual([])
  })

  it('reports already-loaded and independently unavailable matches', async () => {
    const { ctx } = await harness({ alwaysVisible: ['read_file'] })
    ctx.tools.register(fixture('read_file', 'Read a file'))
    ctx.tools.register(fixture('restricted_probe', 'Probe a restricted target'))
    const agent = createAgent(ctx, 'statuses')

    const loaded = await execute(ctx, agent, TOOL_SEARCH_NAME, { query: 'read_file' })
    expect(loaded.isError ? undefined : loaded.value).toMatchObject({
      tools: [{ name: 'read_file', status: 'already_loaded' }],
    })
    agent.ctx.tools.restrict({ deny: ['restricted_probe'] })
    const unavailable = await execute(ctx, agent, TOOL_SEARCH_NAME, { query: 'restricted_probe' })
    expect(unavailable.isError ? undefined : unavailable.value).toMatchObject({
      tools: [{ name: 'restricted_probe', status: 'unavailable' }],
    })
    expect(schemaNames(ctx, agent)).not.toContain('restricted_probe')
  })

  it('rolls visibility back when the durable selection append fails', async () => {
    const { ctx } = await harness({ maxResults: 1 })
    ctx.tools.register(fixture('alpha_probe', 'First probe'))
    ctx.tools.register(fixture('beta_probe', 'Second probe'))
    const agent = createAgent(ctx, 'append-rollback')
    await execute(ctx, agent, TOOL_SEARCH_NAME, { query: 'alpha_probe' })
    const append = vi.spyOn(agent.session, 'append').mockImplementationOnce(() => {
      throw new Error('selection persistence failed')
    })

    const failed = await execute(ctx, agent, TOOL_SEARCH_NAME, { query: 'beta_probe' })
    expect(failed).toMatchObject({
      isError: true,
      error: { message: 'selection persistence failed' },
    })
    expect(schemaNames(ctx, agent)).toContain('alpha_probe')
    expect(schemaNames(ctx, agent)).not.toContain('beta_probe')
    expect(selectionEvents(agent).at(-1)?.data.selected).toEqual(['alpha_probe'])
    append.mockRestore()
  })

  it('requires the owning agent even when its scoped definition is invoked directly', async () => {
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'owner-check')
    const definition = ctx.tools.get(TOOL_SEARCH_NAME, agent)
    if (definition === undefined) throw new Error('missing scoped tool_search definition')
    await expect(definition.execute(
      { query: 'anything' },
      { agent: undefined } as unknown as ToolRunContext,
    )).rejects.toThrow(/owning live agent/)
  })

  it('projects stable UI call and success/failure result intents', async () => {
    const { ctx } = await harness()
    const agent = createAgent(ctx, 'presentation')
    const definition = ctx.tools.get(TOOL_SEARCH_NAME, agent)
    if (definition === undefined) throw new Error('missing scoped tool_search definition')
    expect(definition.presentCall?.({ query: 'weather' })).toEqual({
      card: 'generic', title: 'Search tools', kind: 'search', rawInput: 'weather',
    })
    expect(definition.presentResult?.({ query: 'weather' }, { isError: false, content: [] })).toMatchObject({
      title: 'Tool search results',
    })
    expect(definition.presentResult?.({ query: 'weather' }, { isError: true, content: [] })).toMatchObject({
      title: 'Tool search failed',
    })
  })

  it('handles duplicate lifecycle notifications and an already-uninstalled agent', async () => {
    const { ctx } = await harness()
    ctx.tools.register(fixture('global_probe', 'Global probe'))
    const agent = createAgent(ctx, 'duplicate-lifecycle')
    expect(() => { ctx.emit('agent/created', { agent }) }).not.toThrow()
    ctx.emit('agent/disposed', { agent })
    expect(schemaNames(ctx, agent)).toEqual(['global_probe'])
    expect(() => { ctx.emit('agent/disposed', { agent }) }).not.toThrow()
  })

  it('cleans a scoped search registration when initial restriction setup fails', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const agent = createAgent(ctx, 'install-rollback')
    const restrict = vi.spyOn(ctx.tools, 'restrict').mockImplementationOnce(() => {
      throw new Error('restriction setup failed')
    })
    await expect(ctx.plugin(ToolSearch, {}).then(() => undefined)).rejects.toThrow(/restriction setup failed/)
    expect(ctx.tools.get(TOOL_SEARCH_NAME, agent)).toBeUndefined()
    restrict.mockRestore()
  })

  it('supports punctuation-only no-match queries and direct default resolution', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.tools.register(fixture('plain_probe', 'Plain probe'))
    ToolSearch.apply(ctx, {})
    const agent = createAgent(ctx, 'direct-defaults')
    const result = await execute(ctx, agent, TOOL_SEARCH_NAME, { query: '---' })
    expect(result.isError ? undefined : result.value).toEqual({
      query: '---', tools: [], remainingDeferred: 1,
    })
  })

  it('hot-loads existing agents and restores their original surface on plugin disposal', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.tools.register(fixture('before_plugin', 'Registered before tool search'))
    const agent = createAgent(ctx, 'hot-load')
    expect(schemaNames(ctx, agent)).toEqual(['before_plugin'])

    const plugin = await ctx.plugin(ToolSearch, {})
    expect(schemaNames(ctx, agent)).toEqual([TOOL_SEARCH_NAME])
    await plugin.dispose()
    expect(schemaNames(ctx, agent)).toEqual(['before_plugin'])
  })
})

describe('configuration', () => {
  it.each([
    [{ maxResults: 0 }, /maxResults/],
    [{ maxQueryChars: 1.5 }, /maxQueryChars/],
    [{ alwaysVisible: [''] }, /alwaysVisible/],
    [{ alwaysVisible: ['x', 'x'] }, /repeats pattern/],
    [{ alwaysVisible: [' x'] }, /surrounding whitespace/],
  ] as const)('rejects invalid policy %#', async (config, message) => {
    const ctx = new Context()
    contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await expect(ctx.plugin(ToolSearch, config as Config).then(() => undefined)).rejects.toThrow(message)
  })
})
