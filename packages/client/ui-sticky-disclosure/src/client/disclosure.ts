/**
 * DOM helpers over ui-primitives DisclosureRow and ui-conversation's
 * `[data-conversation-scroll]` scrollport. The overlay never imports those
 * packages; it observes the published data attributes.
 */

/** Conversation scrollport owned by ui-conversation. */
export const SCROLLPORT_SELECTOR = '[data-conversation-scroll]'
/** Disclosure header owned by ui-primitives DisclosureRow. */
export const ROW_SELECTOR = '[data-disclosure-row]'
/** Pixels of tolerance for "fully slid off the top edge". */
export const EDGE_TOLERANCE = 0.5

/**
 * The conversation scrollport, if present and an HTMLElement.
 * @param root - document or a test subtree.
 * @returns the scrollport or null.
 */
export function currentScrollport(root: ParentNode): HTMLElement | null {
  const el = root.querySelector(SCROLLPORT_SELECTOR)
  return el instanceof HTMLElement ? el : null
}

/**
 * Whether a disclosure header is expanded (parent carries `data-open`).
 * @param row - a `[data-disclosure-row]` header.
 * @returns true when the section is open.
 */
export function isExpandedRow(row: Element): boolean {
  return row.parentElement !== null && row.parentElement.hasAttribute('data-open')
}

/**
 * Whether the header sits in the composer seat (not the transcript).
 * @param row - a disclosure header.
 * @returns true when the row belongs to the composer.
 */
export function isComposerRow(row: Element): boolean {
  return row.closest('[data-composer-seat]') !== null
}

/**
 * Human-readable label for a disclosure header.
 * @param row - a `[data-disclosure-row]` header.
 * @param fallback - copy used when the header has no title.
 * @returns at most 80 characters of title, else the variant, else fallback.
 */
export function labelOfRow(row: Element, fallback: string): string {
  const title = row.children[1]
  const text = title?.textContent?.trim() ?? ''
  if (text !== '') return text.slice(0, 80)
  const variantHost = row.closest('[data-variant]')
  const variant = variantHost?.getAttribute('data-variant')
  if (variant !== null && variant !== undefined && variant !== '' && variant !== 'others') return variant
  return fallback
}

/**
 * The element whose click toggles this disclosure.
 * @param row - a disclosure header.
 * @returns the expandable row or its `aria-expanded` button.
 */
export function toggleTarget(row: Element): Element {
  if (row.hasAttribute('data-expandable')) return row
  return row.querySelector('button[aria-expanded]') ?? row
}

/**
 * Collapse one disclosure by dispatching a click to its toggle.
 * @param row - a disclosure header.
 */
export function collapseRow(row: Element): void {
  const target = toggleTarget(row)
  if (target instanceof HTMLElement) target.click()
}

/**
 * Expanded transcript disclosures inside the scrollport (composer excluded).
 * @param scrollport - the conversation scrollport.
 * @returns headers that are currently open.
 */
export function expandedDisclosures(scrollport: ParentNode): Element[] {
  const out: Element[] = []
  for (const row of scrollport.querySelectorAll(ROW_SELECTOR)) {
    if (isExpandedRow(row) && !isComposerRow(row)) out.push(row)
  }
  return out
}

/**
 * Whether an expanded header has fully slid off the scrollport's top edge.
 * @param row - a disclosure header.
 * @param scrollportRect - the scrollport's viewport box.
 * @returns true when the header's bottom is at or above the top edge.
 */
export function isOffTop(row: Element, scrollportRect: DOMRectReadOnly): boolean {
  return row.getBoundingClientRect().bottom <= scrollportRect.top + EDGE_TOLERANCE
}
