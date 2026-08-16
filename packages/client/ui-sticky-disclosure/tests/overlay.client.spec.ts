// @vitest-environment jsdom
/**
 * Sticky overlay: affix chips, collapse-all, hotkey capture, and dispose.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../src/client/locales.ts'
import { DEFAULT_HOTKEY, HOTKEY_STORAGE_KEY as STORAGE_KEY } from '../src/client/hotkey.ts'
import { StickyDisclosureOverlay } from '../src/client/overlay.ts'
import type { OverlayTranslate } from '../src/client/overlay.ts'

class MockResizeObserver {
  static latest: MockResizeObserver | undefined
  callback: ResizeObserverCallback
  observed = new Set<Element>()
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    MockResizeObserver.latest = this
  }
  observe(target: Element): void { this.observed.add(target) }
  unobserve(target: Element): void { this.observed.delete(target) }
  disconnect(): void { this.observed.clear() }
  fire(): void {
    this.callback(
      [...this.observed].map(target => ({ target }) as ResizeObserverEntry),
      this as unknown as ResizeObserver,
    )
  }
}

beforeEach(() => {
  MockResizeObserver.latest = undefined
  vi.stubGlobal('ResizeObserver', MockResizeObserver)
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

const translate = (): OverlayTranslate => (key, params) => {
  const template = en[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

function memoryStorage(seed?: string): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>()
  if (seed !== undefined) map.set(STORAGE_KEY, seed)
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value) },
  }
}

function rect(top: number, right: number, bottom: number, left: number): DOMRect {
  return {
    top, right, bottom, left, width: right - left, height: bottom - top, x: left, y: top,
    toJSON: () => ({}),
  }
}

function mountThreeRows(): void {
  document.body.innerHTML = `
    <div data-conversation-scroll>
      <div data-open>
        <div data-disclosure-row data-expandable id="alpha">
          <span></span><span>Alpha</span>
        </div>
      </div>
      <div data-open>
        <div data-disclosure-row data-expandable id="beta">
          <span></span><span>Beta</span>
        </div>
      </div>
      <div data-open>
        <div data-disclosure-row data-expandable id="gamma">
          <span></span><span>Gamma</span>
        </div>
      </div>
    </div>
  `
  const sp = document.querySelector('[data-conversation-scroll]') as HTMLElement
  sp.getBoundingClientRect = () => rect(0, 800, 400, 0)
  Object.defineProperty(sp, 'offsetWidth', { value: 80, configurable: true })
  for (const [id, top] of [['alpha', -60], ['beta', -40], ['gamma', -20]] as const) {
    const row = document.getElementById(id)!
    row.getBoundingClientRect = () => rect(top, 100, top + 16, 0)
    row.addEventListener('click', () => { row.parentElement?.removeAttribute('data-open') })
  }
}

function mountTranscript(opts: { offTop?: boolean; composer?: boolean } = {}): HTMLElement {
  document.body.innerHTML = `
    <div data-conversation-scroll>
      <div data-open>
        <div data-disclosure-row data-expandable id="think">
          <span></span><span>Think</span>
        </div>
        <div>body</div>
      </div>
      ${opts.composer === true ? `
        <div data-composer-seat>
          <div data-open>
            <div data-disclosure-row data-expandable id="composer">
              <span></span><span>Composer</span>
            </div>
          </div>
        </div>` : ''}
    </div>
  `
  const sp = document.querySelector('[data-conversation-scroll]') as HTMLElement
  sp.getBoundingClientRect = () => rect(0, 800, 400, 0)
  Object.defineProperty(sp, 'offsetWidth', { value: 80, configurable: true })
  const think = document.getElementById('think')!
  think.getBoundingClientRect = () => opts.offTop === true ? rect(-20, 100, -4, 0) : rect(40, 100, 60, 0)
  think.addEventListener('click', () => {
    think.parentElement?.removeAttribute('data-open')
  })
  return think
}

function overlay(storage = memoryStorage()): StickyDisclosureOverlay {
  const instance = new StickyDisclosureOverlay({
    document,
    window: window as Window & typeof globalThis,
    storage,
    translate: translate(),
    mac: false,
    schedule: (callback) => {
      queueMicrotask(callback)
      return 1
    },
  })
  instance.start()
  return instance
}

async function tick(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('StickyDisclosureOverlay', () => {
  it('shows the collapse-all control with a live count and collapses every row', async () => {
    mountTranscript()
    const instance = overlay()
    await tick()
    const control = document.querySelector('[data-sticky-disclosure-control]') as HTMLButtonElement
    expect(control).toBeTruthy()
    expect(control.querySelector('[data-sticky-disclosure-count]')?.textContent).toBe('·1')
    control.click()
    await tick()
    expect(document.getElementById('think')?.parentElement?.hasAttribute('data-open')).toBe(false)
    instance.stop()
    expect(document.querySelector('[data-sticky-disclosure-control]')).toBeNull()
  })

  it('pins a chip when the expanded header has scrolled off the top, then collapses from the chip', async () => {
    mountTranscript({ offTop: true })
    const instance = overlay()
    await tick()
    const chip = document.querySelector('[data-sticky-disclosure-chip]') as HTMLButtonElement
    expect(chip).toBeTruthy()
    expect(chip.textContent).toContain('Think')
    expect(document.querySelector('[data-sticky-disclosure-dock]')).toBeTruthy()
    chip.click()
    expect(document.getElementById('think')?.parentElement?.hasAttribute('data-open')).toBe(false)
    instance.stop()
  })

  it('does not pin a composer disclosure', async () => {
    mountTranscript({ offTop: true, composer: true })
    const composer = document.getElementById('composer')!
    composer.getBoundingClientRect = () => rect(-20, 100, -4, 0)
    const instance = overlay()
    await tick()
    const chips = [...document.querySelectorAll('[data-sticky-disclosure-chip]')]
    expect(chips).toHaveLength(1)
    expect(chips[0]!.textContent).toContain('Think')
    instance.stop()
  })

  it('collapses all from the default hotkey', async () => {
    mountTranscript()
    const instance = overlay()
    await tick()
    document.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyC', ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
    }))
    expect(document.getElementById('think')?.parentElement?.hasAttribute('data-open')).toBe(false)
    instance.stop()
  })

  it('captures a new hotkey, persists it, and restores the default', async () => {
    mountTranscript()
    const storage = memoryStorage()
    const instance = overlay(storage)
    await tick()
    const gear = document.querySelector('[data-sticky-disclosure-gear]') as HTMLButtonElement
    gear.click()
    expect(document.querySelector('[data-sticky-disclosure-settings]')).toBeTruthy()
    const capture = document.querySelector('[data-sticky-disclosure-capture]') as HTMLButtonElement
    capture.click()
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Control', code: 'ControlLeft', ctrlKey: true, bubbles: true, cancelable: true,
    }))
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }))
    await tick()
    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')).toMatchObject({
      ctrl: true, shift: true, code: 'KeyK',
    })
    expect(document.querySelector('[data-sticky-disclosure-current]')?.textContent).toBe('Ctrl+Shift+K')
    const reset = document.querySelector('[data-sticky-disclosure-reset]') as HTMLButtonElement
    reset.click()
    expect(JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null')).toEqual(DEFAULT_HOTKEY)
    gear.click()
    expect(document.querySelector('[data-sticky-disclosure-settings]')).toBeNull()
    instance.stop()
  })

  it('cancels hotkey capture on Escape', async () => {
    mountTranscript()
    const instance = overlay()
    await tick()
    ;(document.querySelector('[data-sticky-disclosure-gear]') as HTMLButtonElement).click()
    ;(document.querySelector('[data-sticky-disclosure-capture]') as HTMLButtonElement).click()
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
    }))
    expect(document.querySelector('[data-sticky-disclosure-capture]')?.textContent).not.toContain('Press')
    instance.stop()
  })

  it('hides the control when the scrollport is gone', async () => {
    mountTranscript()
    const instance = overlay()
    await tick()
    expect(document.querySelector('[data-sticky-disclosure-control]')).toBeTruthy()
    document.body.innerHTML = ''
    instance.update()
    expect(document.querySelector('[data-sticky-disclosure-control]')).toBeNull()
    instance.stop()
  })

  it('does not pin a still-visible header, and closes the settings panel from the close button', async () => {
    mountTranscript({ offTop: false })
    const instance = overlay()
    await tick()
    expect(document.querySelector('[data-sticky-disclosure-chip]')).toBeNull()
    ;(document.querySelector('[data-sticky-disclosure-gear]') as HTMLButtonElement).click()
    expect(document.querySelector('[data-sticky-disclosure-settings]')).toBeTruthy()
    ;(document.querySelector('[aria-label="Close"]') as HTMLButtonElement).click()
    expect(document.querySelector('[data-sticky-disclosure-settings]')).toBeNull()
    instance.stop()
  })

  it('drops a chip when the header scrolls back into view or leaves the tree', async () => {
    const think = mountTranscript({ offTop: true })
    const instance = overlay()
    await tick()
    expect(document.querySelector('[data-sticky-disclosure-chip]')).toBeTruthy()
    think.getBoundingClientRect = () => rect(40, 100, 60, 0)
    instance.update()
    expect(document.querySelector('[data-sticky-disclosure-chip]')).toBeNull()
    think.getBoundingClientRect = () => rect(-20, 100, -4, 0)
    think.parentElement?.setAttribute('data-open', '')
    instance.update()
    expect(document.querySelector('[data-sticky-disclosure-chip]')).toBeTruthy()
    think.remove()
    instance.update()
    expect(document.querySelector('[data-sticky-disclosure-chip]')).toBeNull()
    instance.stop()
  })

  it('pins two off-top rows, collapses one from its chip, and ignores a second click', async () => {
    mountThreeRows()
    const instance = overlay()
    await tick()
    expect(document.querySelectorAll('[data-sticky-disclosure-chip]')).toHaveLength(3)
    const dock = document.querySelector('[data-sticky-disclosure-dock]')!
    dock.append(document.createElement('span'))
    instance.update()
    const chips = [...document.querySelectorAll('[data-sticky-disclosure-chip]')] as HTMLButtonElement[]
    chips[1]!.click()
    expect(document.querySelectorAll('[data-sticky-disclosure-chip]')).toHaveLength(2)
    chips[1]!.click()
    instance.stop()
  })

  it('coalesces scroll and resize into one update, and stop is idempotent', async () => {
    mountTranscript({ offTop: true })
    const instance = overlay()
    document.dispatchEvent(new Event('scroll', { bubbles: true }))
    window.dispatchEvent(new Event('resize'))
    await tick()
    expect(document.querySelector('[data-sticky-disclosure-chip]')).toBeTruthy()
    MockResizeObserver.latest?.fire()
    await tick()
    instance.stop()
    MockResizeObserver.latest?.fire()
    instance.stop()
    expect(document.querySelector('[data-sticky-disclosure-control]')).toBeNull()
  })

  it('collapses leftover chips after the scrollport is removed', async () => {
    mountTranscript({ offTop: true })
    const instance = overlay()
    await tick()
    expect(document.querySelector('[data-sticky-disclosure-chip]')).toBeTruthy()
    document.body.innerHTML = ''
    document.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'KeyC', ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
    }))
    instance.stop()
  })

  it('tracks a replacement scrollport and a missing count label', async () => {
    mountTranscript()
    const instance = overlay()
    await tick()
    document.querySelector('[data-sticky-disclosure-count]')?.remove()
    instance.update()
    const first = document.querySelector('[data-conversation-scroll]') as HTMLElement
    const replacement = document.createElement('div')
    replacement.setAttribute('data-conversation-scroll', '')
    replacement.innerHTML = first.innerHTML
    replacement.getBoundingClientRect = () => rect(0, 800, 400, 0)
    Object.defineProperty(replacement, 'offsetWidth', { value: 80, configurable: true })
    first.replaceWith(replacement)
    instance.update()
    instance.update()
    instance.stop()
  })

  it('positions the settings panel without a live control, then with neither control nor scrollport', async () => {
    mountTranscript()
    const instance = overlay()
    await tick()
    const gear = document.querySelector('[data-sticky-disclosure-gear]') as HTMLButtonElement
    document.querySelector('[data-sticky-disclosure-control]')!.remove()
    gear.click()
    expect(document.querySelector('[data-sticky-disclosure-settings]')).toBeTruthy()
    ;(document.querySelector('[aria-label="Close"]') as HTMLButtonElement).click()
    document.querySelector('[data-sticky-disclosure-control]')?.remove()
    document.querySelector('[data-conversation-scroll]')!.remove()
    gear.click()
    expect(document.querySelector('[data-sticky-disclosure-settings]')).toBeTruthy()
    instance.stop()
  })

  it('ignores modifier-only and unmodified keys while capturing, and rejects an empty code', async () => {
    mountTranscript({ offTop: true })
    const instance = overlay()
    await tick()
    ;(document.querySelector('[data-sticky-disclosure-gear]') as HTMLButtonElement).click()
    ;(document.querySelector('[data-sticky-disclosure-capture]') as HTMLButtonElement).click()
    for (const key of ['Shift', 'Alt', 'Meta'] as const) {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key, code: `${key}Left`, bubbles: true, cancelable: true,
      }))
    }
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a', code: 'KeyA', bubbles: true, cancelable: true,
    }))
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a', code: '', ctrlKey: true, bubbles: true, cancelable: true,
    }))
    expect(document.querySelector('[data-sticky-disclosure-capture]')?.textContent).toContain('Press')
    ;(document.querySelector('[data-sticky-disclosure-capture]') as HTMLButtonElement).click()
    expect(document.querySelector('[data-sticky-disclosure-capture]')?.textContent).not.toContain('Press')
    instance.stop()
  })

  it('refreshes chip titles after a captured hotkey, even if the panel has been detached', async () => {
    mountTranscript({ offTop: true })
    const instance = overlay()
    await tick()
    ;(document.querySelector('[data-sticky-disclosure-gear]') as HTMLButtonElement).click()
    ;(document.querySelector('[data-sticky-disclosure-capture]') as HTMLButtonElement).click()
    document.querySelector('[data-sticky-disclosure-settings]')!.remove()
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k', code: 'KeyK', metaKey: true, bubbles: true, cancelable: true,
    }))
    await tick()
    const chip = document.querySelector('[data-sticky-disclosure-chip]') as HTMLButtonElement
    expect(chip.title).toContain('Meta+K')
    instance.stop()
  })
})
