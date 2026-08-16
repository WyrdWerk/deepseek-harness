/** Package-owned durable selection invariants. @module @deepseek-ai/dsh-tool-search/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { decodeToolSearchSelection, type ToolSearchSelection } from './selection.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-search'

/** Cordis companion plugin name. */
export const name = 'tool-search-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one session's selection snapshots as strict cumulative supersets. */
function validateEvents(events: readonly SessionEvent[], fail: InvariantFailure): void {
  let selected = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool-search/selection') continue
    let snapshot: ToolSearchSelection
    try {
      snapshot = decodeToolSearchSelection(event.data, 'tool-search/selection')
    } catch (error: unknown) {
      fail((error as Error).message)
    }
    const next = new Set(snapshot.selected)
    for (const toolName of selected) {
      if (!next.has(toolName)) fail(`tool-search/selection dropped selected tool ${JSON.stringify(toolName)}`)
    }
    if (next.size === selected.size) fail('tool-search/selection must add at least one tool')
    selected = next
  }
}

/** Install validation for loaded sessions and each newly appended selection. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const prefixes = new WeakMap<Session, SessionEvent[]>()
  for (const session of ctx.sessions.list()) {
    const events = [...session.events]
    validateEvents(events, fail)
    prefixes.set(session, events)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'tool-search/selection') return
    const events = [...prefixes.get(session) ?? session.events.slice(0, event.seq), event]
    validateEvents(events, fail)
    prefixes.set(session, events)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
