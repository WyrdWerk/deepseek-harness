import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantService from '@deepseek-ai/dsh-invariants'
import SessionStore, { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as ToolSearchInvariant from '../src/invariant.ts'
import { compareToolNames, decodeToolSearchSelection } from '../src/selection.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantService)
  await ctx.plugin(ToolSearchInvariant)
  return ctx
}

describe('tool-search invariants', () => {
  it('accepts strict cumulative whole snapshots', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create()
    expect(() => {
      ctx.emit('tools/change')
      session.append('turn/start', { turn: 1 })
      session.append('tool-search/selection', { query: 'read', selected: ['read_file'] })
      session.append('tool-search/selection', {
        query: 'web',
        selected: ['read_file', 'web_search'],
      })
    }).not.toThrow()
  })

  it('rejects malformed, repeated, and shrinking snapshots', async () => {
    const ctx = await setup()
    const malformed = ctx.sessions.create()
    expect(() => malformed.append('tool-search/selection', {
      query: '', selected: ['read_file'],
    })).toThrow(/non-empty trimmed string/)

    const unsorted = ctx.sessions.create()
    expect(() => unsorted.append('tool-search/selection', {
      query: 'tools', selected: ['web_search', 'read_file'],
    })).toThrow(/unique and sorted/)

    const repeated = ctx.sessions.create()
    repeated.append('tool-search/selection', { query: 'read', selected: ['read_file'] })
    expect(() => repeated.append('tool-search/selection', {
      query: 'read again', selected: ['read_file'],
    })).toThrow(/must add at least one tool/)

    const shrinking = ctx.sessions.create()
    shrinking.append('tool-search/selection', {
      query: 'both', selected: ['read_file', 'web_search'],
    })
    expect(() => shrinking.append('tool-search/selection', {
      query: 'web', selected: ['web_search'],
    })).toThrow(/dropped selected tool/)
  })

  it('validates every durable selection field and ordering branch', () => {
    for (const value of [null, [], 'selection']) {
      expect(() => decodeToolSearchSelection(value, 'selection')).toThrow(/must be an object/)
    }
    expect(() => decodeToolSearchSelection({ query: 'x' }, 'selection'))
      .toThrow(/exactly query and selected/)
    expect(() => decodeToolSearchSelection({ query: 'x', selected: 'read' }, 'selection'))
      .toThrow(/selected must be an array/)
    for (const selected of [[1], [''], [' read']]) {
      expect(() => decodeToolSearchSelection({ query: 'x', selected }, 'selection'))
        .toThrow(/entries must be non-empty trimmed strings/)
    }
    expect(() => decodeToolSearchSelection({ query: 'x', selected: ['read', 'read'] }, 'selection'))
      .toThrow(/unique and sorted/)
    expect(compareToolNames('same', 'same')).toBe(0)
  })

  it('adopts a detached session on first relevant publication', async () => {
    const ctx = await setup()
    const session = Session.create(SessionId('detached-tool-search'))
    const event: SessionEvent<'tool-search/selection'> = {
      type: 'tool-search/selection', seq: 0, time: 0,
      data: { query: 'read', selected: ['read_file'] },
    }
    expect(() => { ctx.emit('session/event', session, event) }).not.toThrow()
  })

  it('rejects an invalid selection already present when the companion loads', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const seed: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      ...[1, 2].map(seq => ({
        type: 'tool-search/selection',
        seq,
        time: seq,
        data: { query: 'repeat', selected: ['read_file'] },
      } satisfies SessionEvent<'tool-search/selection'>)),
    ]
    ctx.sessions.create(SessionId('invalid-tool-search-seed'), { seed })
    await ctx.plugin(InvariantService)
    await expect(ctx.plugin(ToolSearchInvariant).then(() => undefined))
      .rejects.toThrow(/must add at least one tool/)
  })
})
