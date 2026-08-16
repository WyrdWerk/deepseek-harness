/**
 * Turn-settled advisor for the DeepSeek Harness agent loop.
 *
 * A second model reviews the session transcript after every few closed turns
 * — and immediately after tool errors, cooled down — against the operating
 * constitution, then injects a silent-unless-material advisory note through
 * `agent.inject()` for the next admitted request. The design adopts two
 * proven mechanisms: opencode's advisor profile (behavior constitution:
 * source discipline, anti-hallucination, confidence labels) and pi's advisor
 * actor (event-triggered, directive, prefers silence, never steers every
 * turn).
 *
 * Reviews run only for root sessions (`delegationDepth === 0`), at most one
 * at a time per session, and never wake the driver: an injected note waits
 * for the next step the agent already owes.
 *
 * ```yaml
 * - id: advisor
 *   name: '@deepseek-ai/dsh-advisor'
 *   config:
 *     provider: openai
 *     model: gpt-4o-mini
 *     cadenceTurns: 3
 * ```
 *
 * @module @deepseek-ai/dsh-advisor
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { buildDigest } from './digest.ts'
import { advisorSystemPrompt, normalizeAdvisory } from './prompt.ts'

export { buildDigest } from './digest.ts'
export { advisorSystemPrompt, isSilentResponse, normalizeAdvisory } from './prompt.ts'

/** Plugin configuration. */
export interface Config {
  /** Master switch; false unmounts all listener effects. */
  enabled: boolean
  /** Reviewer provider route. */
  provider: string
  /** Reviewer model id. */
  model: string
  /** Closed turns between scheduled reviews. */
  cadenceTurns: number
  /** Approximate character budget for the transcript digest. */
  maxDigestChars: number
  /** Character cap for one injected advisory. */
  maxAdvisoryChars: number
  /** Whether tool errors trigger an immediate review. */
  wakeOnToolError: boolean
  /** Minimum milliseconds between tool-error reviews. */
  toolErrorCooldownMs: number
  /** Per-review LLM call timeout. */
  timeoutMs: number
  /** Extra deployment guidance appended to the constitution. */
  extraGuidance: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  provider: z.string().default('openai'),
  model: z.string().default('gpt-4o-mini'),
  cadenceTurns: z.number().step(1).min(1).default(3),
  maxDigestChars: z.number().step(1).min(500).default(24_000),
  maxAdvisoryChars: z.number().step(1).min(200).default(2_000),
  wakeOnToolError: z.boolean().default(true),
  toolErrorCooldownMs: z.number().min(0).default(300_000),
  timeoutMs: z.number().min(1_000).max(2 ** 31 - 1).default(90_000),
  extraGuidance: z.string().default(''),
})

export const name = 'advisor'
export const inject = ['llm', 'agents']

/** Per-session advisory bookkeeping. */
interface AdvisorSessionState {
  turnsSinceReview: number
  busy: boolean
  lastToolErrorAdvisory: number
}

/** Mount the advisor on the session event stream. */
export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return
  const states = new Map<string, AdvisorSessionState>()
  let alive = true
  ctx.effect(() => () => {
    alive = false
    states.clear()
  })

  const stateOf = (session: Session): AdvisorSessionState => {
    let state = states.get(session.id)
    if (state === undefined) {
      state = { turnsSinceReview: 0, busy: false, lastToolErrorAdvisory: 0 }
      states.set(session.id, state)
    }
    return state
  }

  const runAdvisory = async (session: Session, agent: Agent, trigger: 'turn' | 'tool-error'): Promise<void> => {
    const digest = buildDigest(session.deriveMessages(), config.maxDigestChars)
    if (digest.trim().length === 0) return
    const signal = AbortSignal.timeout(config.timeoutMs)
    let text = ''
    for await (const chunk of ctx.llm.stream({
      provider: config.provider,
      model: config.model,
      system: advisorSystemPrompt(config.extraGuidance),
      messages: [createUserMessage({
        content: [{ type: 'text', text: `Review trigger: ${trigger}. Recent transcript digest:\n\n${digest}` }],
        source: { kind: 'plugin', plugin: 'advisor' },
      })],
      signal,
    })) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) return
    }
    if (!alive) return
    const advisory = normalizeAdvisory(text, config.maxAdvisoryChars)
    if (advisory === undefined) return
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: `[Advisor note — ${trigger === 'turn' ? 'turn review' : 'tool error'}]\n${advisory}`,
      }],
      source: { kind: 'plugin', plugin: 'advisor' },
    }))
  }

  const scheduleAdvisory = (session: Session, trigger: 'turn' | 'tool-error'): void => {
    const agent = ctx.agents.get(session.id)
    if (agent === undefined) return
    const state = stateOf(session)
    if (state.busy) return
    state.busy = true
    void runAdvisory(session, agent, trigger)
      .catch(error => ctx.logger.warn(`advisor: review failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        state.busy = false
      })
  }

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (!alive) return
    if ((session.header.delegationDepth ?? 0) !== 0) return
    if (event.type === 'turn/end') {
      const state = stateOf(session)
      state.turnsSinceReview += 1
      if (state.turnsSinceReview >= config.cadenceTurns) {
        state.turnsSinceReview = 0
        scheduleAdvisory(session, 'turn')
      }
      return
    }
    if (event.type === 'tool/result' && config.wakeOnToolError) {
      const block = event.data.message.content[0]
      const errored = block?.type === 'tool-result' && block.isError === true || event.data.error !== undefined
      if (!errored) return
      const state = stateOf(session)
      const now = Date.now()
      if (now - state.lastToolErrorAdvisory < config.toolErrorCooldownMs) return
      state.lastToolErrorAdvisory = now
      scheduleAdvisory(session, 'tool-error')
    }
  })

  ctx.on('session/disposed', (session: Session) => states.delete(session.id))
}
