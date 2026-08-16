/**
 * Sticky disclosure overlay, browser half: pins expanded Think/tool headers
 * that have scrolled off the conversation top edge, and collapses every
 * expanded section from a control and a localStorage hotkey. Export
 * discipline: packages/client/AGENTS.md.
 * @module @deepseek-ai/dsh-client-ui-sticky-disclosure/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, zh } from './locales.ts'
import { StickyDisclosureOverlay } from './overlay.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'stickyDisclosure'

/** Required service: the overlay copy. */
export const inject = ['locale']

/**
 * Client plugin body: register dictionaries and attach the conversation overlay.
 * @param ctx - client root context.
 * @returns nothing.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sticky-disclosure: dictionaries')
  const overlay = new StickyDisclosureOverlay({
    document,
    window,
    storage: window.localStorage,
    translate: ctx.locale.bind(NS),
    mac: /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent),
    schedule: callback => window.requestAnimationFrame(callback),
  })
  ctx.effect(() => {
    overlay.start()
    return () => overlay.stop()
  }, 'ui-sticky-disclosure: overlay')
  ctx.on('locale/change', () => { overlay.update() })
}
