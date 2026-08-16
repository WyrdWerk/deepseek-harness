// @vitest-environment jsdom
/**
 * Client plugin apply: dictionaries, overlay effect, and fiber dispose.
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as StickyInvariant from '../src/invariant.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ui-sticky-disclosure plugin', () => {
  it('has an empty host apply and registers an explained invariant companion', async () => {
    expect(inject).toEqual(['locale'])
    nodeApply()
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(StickyInvariant).await()).resolves.toBeDefined()
  })

  it('attaches the overlay while a conversation scrollport exists and removes it on dispose', async () => {
    document.body.innerHTML = `
      <div data-conversation-scroll style="width:800px;height:400px">
        <div data-open>
          <div data-disclosure-row data-expandable>
            <span></span><span>Think</span>
          </div>
        </div>
      </div>
    `
    const sp = document.querySelector('[data-conversation-scroll]') as HTMLElement
    sp.getBoundingClientRect = () => ({
      top: 0, right: 800, bottom: 400, left: 0, width: 800, height: 400, x: 0, y: 0, toJSON: () => ({}),
    })
    const ctx = new Context()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber
    await new Promise((resolve) => { requestAnimationFrame(() => resolve(undefined)) })
    expect(document.querySelector('[data-sticky-disclosure-control]')).toBeTruthy()
    const next = locale.getLocale().active === 'zh' ? 'en' : 'zh'
    locale.setLocale(next)
    await new Promise((resolve) => { requestAnimationFrame(() => resolve(undefined)) })
    expect(document.querySelector('[data-sticky-disclosure-control]')).toBeTruthy()
    await Promise.resolve(fiber.dispose())
    await new Promise((resolve) => { requestAnimationFrame(() => resolve(undefined)) })
    expect(document.querySelector('[data-sticky-disclosure-control]')).toBeNull()
  })
})
