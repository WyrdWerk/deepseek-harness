/**
 * Conversation overlay: affix chips for expanded disclosures that have
 * scrolled off the top edge, plus a collapse-all control and hotkey.
 */
import {
  collapseRow,
  currentScrollport,
  expandedDisclosures,
  isComposerRow,
  isExpandedRow,
  isOffTop,
  labelOfRow,
  ROW_SELECTOR,
} from './disclosure.ts'
import {
  DEFAULT_HOTKEY,
  labelOfHotkey,
  loadHotkey,
  matchesHotkey,
  normalizeHotkey,
  saveHotkey,
  type HotkeySpec,
} from './hotkey.ts'
import type { StickyDisclosureKey } from './locales.ts'
import styles from './overlay.module.css'

/** Horizontal inset of the chip dock, matching the scrollport content padding. */
const DOCK_INSET_X = 32
/** Vertical gap between the scrollport's top edge and the first chip row. */
const DOCK_TOP_GAP = 8
/** Inset of the floating collapse-all pill from the scrollport corner. */
const CONTROL_INSET = 16

/** Bound translator for this plugin's dictionary. */
export type OverlayTranslate = (
  key: StickyDisclosureKey,
  params?: Record<string, unknown>,
) => string

/** Overlay construction options. */
export interface OverlayOptions {
  /** Document that owns the conversation. */
  document: Document
  /** Window for resize and keydown. */
  window: Window & typeof globalThis
  /** localStorage or a test double. */
  storage: Pick<Storage, 'getItem' | 'setItem'>
  /** Active-locale translator. */
  translate: OverlayTranslate
  /** Apple modifier glyphs when true. */
  mac: boolean
  /** rAF or a test scheduler. */
  schedule: (callback: () => void) => number
}

/**
 * Create an SVG chevron (collapse) icon.
 * @param document - owner document.
 * @returns the svg element.
 */
function chevron(document: Document): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('viewBox', '0 0 14 14')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('class', styles.icon)
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M10.5 8.75 7 5.25l-3.5 3.5')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.25')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.append(path)
  return svg
}

/**
 * Live overlay attached to one document. start() installs observers;
 * stop() removes every node and listener.
 */
export class StickyDisclosureOverlay {
  private readonly chips = new Map<Element, HTMLButtonElement>()
  private dock: HTMLElement | null = null
  private control: HTMLButtonElement | null = null
  private gear: HTMLButtonElement | null = null
  private panel: HTMLElement | null = null
  private hotkey: HotkeySpec
  private capturing = false
  private rafPending = false
  private disposed = false
  private resizeObserver: ResizeObserver | null = null
  private observedScrollport: HTMLElement | null = null
  private observer: MutationObserver | null = null

  /**
   * @param options - document, storage, translator, and scheduler.
   */
  constructor(private readonly options: OverlayOptions) {
    this.hotkey = loadHotkey(options.storage)
  }

  /** Install observers and paint the first frame. */
  start(): void {
    const { document: doc, window: win } = this.options
    this.observer = new MutationObserver(() => { this.scheduleUpdate() })
    this.observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-open', 'data-disclosure-row', 'aria-expanded'],
    })
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => { this.scheduleUpdate() })
      this.resizeObserver.observe(doc.body)
    }
    doc.addEventListener('scroll', this.onScroll, { capture: true, passive: true })
    win.addEventListener('resize', this.onResize)
    doc.addEventListener('keydown', this.onKeyDown, true)
    this.scheduleUpdate()
  }

  /** Tear down every node, observer, and listener. Safe to call twice. */
  stop(): void {
    if (this.disposed) return
    this.disposed = true
    this.disarmCapture()
    this.observer?.disconnect()
    this.observer = null
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.observedScrollport = null
    const { document: doc, window: win } = this.options
    doc.removeEventListener('scroll', this.onScroll, true)
    win.removeEventListener('resize', this.onResize)
    doc.removeEventListener('keydown', this.onKeyDown, true)
    for (const chip of this.chips.values()) chip.remove()
    this.chips.clear()
    this.removeDock()
    this.removeControl()
    this.removeGear()
    this.removePanel()
  }

  /** Recompute chips and the collapse-all control. */
  update(): void {
    this.trackScrollport()
    const sp = currentScrollport(this.options.document)
    const spRect = sp?.getBoundingClientRect() ?? null
    const usable = spRect !== null && spRect.width > 1 && spRect.height > 1
    const seen = new Set<Element>()
    if (sp !== null) {
      for (const row of sp.querySelectorAll(ROW_SELECTOR)) {
        seen.add(row)
        const offTop = isExpandedRow(row) && !isComposerRow(row) && usable
          && isOffTop(row, spRect)
        const chip = this.chips.get(row)
        if (offTop && chip === undefined) this.chips.set(row, this.createChip(row))
        else if (!offTop && chip !== undefined) {
          chip.remove()
          this.chips.delete(row)
        }
      }
    }
    for (const [row, chip] of this.chips) {
      if (!seen.has(row)) {
        chip.remove()
        this.chips.delete(row)
      }
    }
    this.syncDock(sp, spRect)
    this.syncControl(spRect, usable)
  }

  private readonly onScroll = (): void => { this.scheduleUpdate() }
  private readonly onResize = (): void => { this.scheduleUpdate() }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!matchesHotkey(event, this.hotkey)) return
    event.preventDefault()
    this.collapseAll()
  }

  private scheduleUpdate(): void {
    if (this.rafPending || this.disposed) return
    this.rafPending = true
    this.options.schedule(() => {
      this.rafPending = false
      if (!this.disposed) this.update()
    })
  }

  private t(key: StickyDisclosureKey, params?: Record<string, unknown>): string {
    return this.options.translate(key, params)
  }

  private hotkeyLabel(): string {
    return labelOfHotkey(this.hotkey, this.options.mac)
  }

  private collapseAll(): void {
    const sp = currentScrollport(this.options.document)
    if (sp !== null) {
      for (const row of expandedDisclosures(sp)) collapseRow(row)
    }
    for (const chip of this.chips.values()) chip.remove()
    this.chips.clear()
    this.removeDock()
  }

  private createChip(row: Element): HTMLButtonElement {
    const { document: doc } = this.options
    const label = labelOfRow(row, this.t('section.fallback'))
    const chip = doc.createElement('button')
    chip.type = 'button'
    chip.className = styles.chip
    chip.setAttribute('data-sticky-disclosure-chip', '')
    chip.setAttribute('aria-label', this.t('chip.aria', { label }))
    chip.title = this.t('chip.title', { hotkey: this.hotkeyLabel() })
    const text = doc.createElement('span')
    text.className = styles.label
    text.textContent = label
    chip.append(chevron(doc), text)
    chip.addEventListener('click', () => {
      collapseRow(row)
      const live = this.chips.get(row)
      if (live !== undefined) {
        live.remove()
        this.chips.delete(row)
      }
      if (this.chips.size === 0) this.removeDock()
    })
    return chip
  }

  private createControl(): HTMLButtonElement {
    const { document: doc } = this.options
    const btn = doc.createElement('button')
    btn.type = 'button'
    btn.className = styles.control
    btn.setAttribute('data-sticky-disclosure-control', '')
    btn.title = this.t('control.title', { hotkey: this.hotkeyLabel() })
    btn.setAttribute('aria-label', this.t('control.aria'))
    const label = doc.createElement('span')
    label.className = styles.label
    label.textContent = this.t('control.label')
    const count = doc.createElement('span')
    count.className = styles.count
    count.setAttribute('data-sticky-disclosure-count', '')
    btn.append(chevron(doc), label, count)
    btn.addEventListener('click', () => { this.collapseAll() })
    return btn
  }

  private createGear(): HTMLButtonElement {
    const { document: doc } = this.options
    const btn = doc.createElement('button')
    btn.type = 'button'
    btn.className = styles.gear
    btn.setAttribute('data-sticky-disclosure-gear', '')
    btn.title = this.t('gear.aria')
    btn.setAttribute('aria-label', this.t('gear.aria'))
    btn.textContent = '⌨'
    btn.addEventListener('click', () => {
      if (this.panel !== null && this.panel.isConnected) {
        this.removePanel()
        return
      }
      this.openPanel()
    })
    return btn
  }

  private renderPanel(): void {
    if (this.panel === null || !this.panel.isConnected) return
    const { document: doc } = this.options
    this.panel.replaceChildren()
    const title = doc.createElement('div')
    title.className = styles.panelTitle
    const titleText = doc.createElement('span')
    titleText.textContent = this.t('panel.title')
    const close = doc.createElement('button')
    close.type = 'button'
    close.className = styles.close
    close.setAttribute('aria-label', this.t('panel.close'))
    close.textContent = '✕'
    close.addEventListener('click', () => { this.removePanel() })
    title.append(titleText, close)
    const row = doc.createElement('div')
    row.className = styles.panelRow
    const kbd = doc.createElement('span')
    kbd.className = styles.kbd
    kbd.setAttribute('data-sticky-disclosure-current', '')
    kbd.textContent = this.hotkeyLabel()
    const captureBtn = doc.createElement('button')
    captureBtn.type = 'button'
    captureBtn.className = styles.btn
    captureBtn.setAttribute('data-sticky-disclosure-capture', '')
    captureBtn.textContent = this.capturing ? this.t('panel.capturing') : this.t('panel.set')
    if (this.capturing) captureBtn.dataset.armed = ''
    captureBtn.addEventListener('click', () => {
      if (this.capturing) this.disarmCapture()
      else this.armCapture()
      this.renderPanel()
    })
    row.append(kbd, captureBtn)
    const resetBtn = doc.createElement('button')
    resetBtn.type = 'button'
    resetBtn.className = styles.btn
    resetBtn.setAttribute('data-sticky-disclosure-reset', '')
    resetBtn.textContent = this.t('panel.reset')
    resetBtn.addEventListener('click', () => {
      this.disarmCapture()
      this.applyHotkey({ ...DEFAULT_HOTKEY })
    })
    const hint = doc.createElement('div')
    hint.className = styles.panelHint
    hint.textContent = this.capturing ? this.t('panel.hintCapture') : this.t('panel.hint')
    this.panel.append(title, row, resetBtn, hint)
  }

  private openPanel(): void {
    this.removePanel()
    const { document: doc } = this.options
    this.panel = doc.createElement('div')
    this.panel.className = styles.panel
    this.panel.setAttribute('data-sticky-disclosure-settings', '')
    doc.body.append(this.panel)
    this.renderPanel()
    this.positionPanel()
  }

  private positionPanel(): void {
    if (this.panel === null || !this.panel.isConnected) return
    const p = this.panel.getBoundingClientRect()
    const anchor = this.control !== null && this.control.isConnected
      ? this.control.getBoundingClientRect()
      : null
    if (anchor === null) {
      const sp = currentScrollport(this.options.document)
      if (sp === null) return
      const r = sp.getBoundingClientRect()
      this.panel.style.left = `${Math.max(0, Math.round(r.right - CONTROL_INSET - p.width))}px`
      this.panel.style.top = `${Math.max(0, Math.round(r.bottom - CONTROL_INSET - 28 - p.height - 8))}px`
      return
    }
    this.panel.style.left = `${Math.max(0, Math.round(anchor.right - p.width))}px`
    this.panel.style.top = `${Math.max(0, Math.round(anchor.top - p.height - 8))}px`
  }

  private readonly onCaptureKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.disarmCapture()
      this.renderPanel()
      return
    }
    if (event.key === 'Control' || event.key === 'Shift' || event.key === 'Alt' || event.key === 'Meta') return
    if (!(event.ctrlKey || event.metaKey || event.altKey)) return
    event.preventDefault()
    event.stopPropagation()
    if (!this.applyHotkey({
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
      shift: event.shiftKey,
      code: event.code,
    })) return
    this.disarmCapture()
    this.renderPanel()
  }

  private armCapture(): void {
    /* v8 ignore next -- the capture button rebuilds after arming, so a second arm cannot re-enter */
    if (this.capturing) return
    this.capturing = true
    this.options.document.addEventListener('keydown', this.onCaptureKey, true)
  }

  private disarmCapture(): void {
    if (!this.capturing) return
    this.capturing = false
    this.options.document.removeEventListener('keydown', this.onCaptureKey, true)
  }

  private applyHotkey(spec: unknown): boolean {
    const next = normalizeHotkey(spec)
    if (next === null) return false
    this.hotkey = next
    saveHotkey(this.options.storage, next)
    const hotkey = this.hotkeyLabel()
    /* v8 ignore next -- titles refresh only while the collapse-all control is mounted */
    if (this.control !== null) this.control.title = this.t('control.title', { hotkey })
    for (const chip of this.chips.values()) chip.title = this.t('chip.title', { hotkey })
    this.renderPanel()
    return true
  }

  private trackScrollport(): void {
    if (this.resizeObserver === null) return
    const sp = currentScrollport(this.options.document)
    if (sp === this.observedScrollport) return
    if (this.observedScrollport !== null) this.resizeObserver.unobserve(this.observedScrollport)
    if (sp !== null) this.resizeObserver.observe(sp)
    this.observedScrollport = sp
  }

  private syncDock(sp: Element | null, spRect: DOMRectReadOnly | null): void {
    if (this.chips.size === 0 || sp === null || spRect === null) {
      this.removeDock()
      return
    }
    const d = this.ensureDock()
    const ordered = [...sp.querySelectorAll(ROW_SELECTOR)].filter(row => this.chips.has(row))
    const desired = ordered.flatMap((row) => {
      const chip = this.chips.get(row)
      return chip === undefined ? [] : [chip]
    })
    let index = 0
    for (const chip of desired) {
      const at = d.children[index] ?? null
      if (at !== chip) d.insertBefore(chip, at)
      index++
    }
    while (d.children.length > desired.length) d.lastChild?.remove()
    const box = spRect
    d.style.left = `${Math.round(box.left + DOCK_INSET_X)}px`
    d.style.top = `${Math.round(box.top + DOCK_TOP_GAP)}px`
    d.style.width = `${Math.max(0, Math.round(box.width - DOCK_INSET_X * 2))}px`
  }

  private syncControl(spRect: DOMRectReadOnly | null, usable: boolean): void {
    if (!usable || spRect === null) {
      this.removeControl()
      this.removeGear()
      this.removePanel()
      return
    }
    const { document: doc } = this.options
    if (this.control === null || !this.control.isConnected) {
      this.control = this.createControl()
      doc.body.append(this.control)
    }
    if (this.gear === null || !this.gear.isConnected) {
      this.gear = this.createGear()
      doc.body.append(this.gear)
    }
    const sp = currentScrollport(doc)
    /* v8 ignore next -- usable layout already required a live scrollport in this update */
    const n = sp === null ? 0 : expandedDisclosures(sp).length
    const count = String(n)
    if (this.control.dataset.count !== count) this.control.dataset.count = count
    const countEl = this.control.querySelector('[data-sticky-disclosure-count]')
    if (countEl !== null) {
      const countText = n > 0 ? `·${n}` : ''
      if (countEl.textContent !== countText) countEl.textContent = countText
    }
    const w = this.control.offsetWidth
    const h = this.control.offsetHeight
    const left = Math.max(0, Math.round(spRect.right - CONTROL_INSET - w - 36))
    const top = Math.max(0, Math.round(spRect.bottom - CONTROL_INSET - h))
    this.control.style.left = `${left}px`
    this.control.style.top = `${top}px`
    this.gear.style.left = `${Math.round(left + w + 8)}px`
    this.gear.style.top = `${top}px`
    this.positionPanel()
  }

  private ensureDock(): HTMLElement {
    if (this.dock !== null && this.dock.isConnected) return this.dock
    const dock = this.options.document.createElement('div')
    dock.className = styles.dock
    dock.setAttribute('data-sticky-disclosure-dock', '')
    this.options.document.body.append(dock)
    this.dock = dock
    return dock
  }

  private removeDock(): void {
    this.dock?.remove()
    this.dock = null
  }

  private removeControl(): void {
    this.control?.remove()
    this.control = null
  }

  private removeGear(): void {
    this.gear?.remove()
    this.gear = null
  }

  private removePanel(): void {
    this.panel?.remove()
    this.panel = null
    this.disarmCapture()
  }
}
