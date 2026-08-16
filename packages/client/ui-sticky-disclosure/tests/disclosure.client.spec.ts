// @vitest-environment jsdom
/**
 * Disclosure DOM helpers over the published data-attribute contract.
 */
import { describe, expect, it } from 'vitest'
import {
  collapseRow,
  currentScrollport,
  expandedDisclosures,
  isComposerRow,
  isExpandedRow,
  isOffTop,
  labelOfRow,
  toggleTarget,
} from '../src/client/disclosure.ts'

function rect(top: number, bottom: number): DOMRectReadOnly {
  return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }
}

describe('disclosure helpers', () => {
  it('finds the conversation scrollport and ignores a missing one', () => {
    document.body.innerHTML = '<div data-conversation-scroll></div>'
    expect(currentScrollport(document)?.hasAttribute('data-conversation-scroll')).toBe(true)
    document.body.innerHTML = '<div></div>'
    expect(currentScrollport(document)).toBeNull()
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('data-conversation-scroll', '')
    document.body.replaceChildren(svg)
    expect(currentScrollport(document)).toBeNull()
  })

  it('labels a title, a variant, and the fallback', () => {
    document.body.innerHTML = `
      <div data-variant="think">
        <div data-open>
          <div data-disclosure-row><span></span><span>  Think  </span></div>
        </div>
      </div>
      <div data-variant="bash">
        <div data-open>
          <div data-disclosure-row><span></span><span></span></div>
        </div>
      </div>
      <div data-variant="others">
        <div data-open>
          <div data-disclosure-row><span></span><span></span></div>
        </div>
      </div>
    `
    const rows = [...document.querySelectorAll('[data-disclosure-row]')]
    expect(labelOfRow(rows[0]!, 'Section')).toBe('Think')
    expect(labelOfRow(rows[1]!, 'Section')).toBe('bash')
    expect(labelOfRow(rows[2]!, 'Section')).toBe('Section')
    const untitled = document.createElement('div')
    untitled.setAttribute('data-disclosure-row', '')
    expect(labelOfRow(untitled, 'Section')).toBe('Section')
    const nullTitle = document.createElement('div')
    nullTitle.setAttribute('data-disclosure-row', '')
    const nullIcon = document.createElement('span')
    const nullText = document.createElement('span')
    Object.defineProperty(nullText, 'textContent', { get: () => null })
    nullTitle.append(nullIcon, nullText)
    expect(labelOfRow(nullTitle, 'Section')).toBe('Section')
    const blankVariant = document.createElement('div')
    blankVariant.setAttribute('data-variant', '')
    const blankRow = document.createElement('div')
    blankRow.setAttribute('data-disclosure-row', '')
    blankVariant.append(blankRow)
    expect(labelOfRow(blankRow, 'Section')).toBe('Section')
    const long = document.createElement('div')
    long.setAttribute('data-disclosure-row', '')
    const icon = document.createElement('span')
    const title = document.createElement('span')
    title.textContent = 'T'.repeat(90)
    long.append(icon, title)
    expect(labelOfRow(long, 'Section')).toHaveLength(80)
  })

  it('toggles expandable rows and aria-expanded buttons', () => {
    document.body.innerHTML = `
      <div data-open>
        <div data-disclosure-row data-expandable></div>
      </div>
      <div data-open>
        <div data-disclosure-row><button aria-expanded="true">x</button></div>
      </div>
    `
    const expandable = document.querySelector('[data-expandable]')!
    const withButton = document.querySelector('[aria-expanded]')!.parentElement!
    expect(toggleTarget(expandable)).toBe(expandable)
    expect(toggleTarget(withButton)).toBe(document.querySelector('[aria-expanded]'))
    const plain = document.createElement('div')
    plain.setAttribute('data-disclosure-row', '')
    expect(toggleTarget(plain)).toBe(plain)
    let clicks = 0
    expandable.addEventListener('click', () => { clicks++ })
    collapseRow(expandable)
    expect(clicks).toBe(1)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('data-disclosure-row', '')
    svg.setAttribute('data-expandable', '')
    expect(() => collapseRow(svg)).not.toThrow()
  })

  it('lists expanded transcript rows and skips the composer', () => {
    document.body.innerHTML = `
      <div data-conversation-scroll>
        <div data-open>
          <div data-disclosure-row data-expandable id="open"></div>
        </div>
        <div>
          <div data-disclosure-row data-expandable id="closed"></div>
        </div>
        <div data-composer-seat>
          <div data-open>
            <div data-disclosure-row data-expandable id="composer"></div>
          </div>
        </div>
      </div>
    `
    const sp = currentScrollport(document)!
    const expanded = expandedDisclosures(sp)
    expect(expanded).toHaveLength(1)
    expect(expanded[0]!.id).toBe('open')
    expect(isExpandedRow(document.getElementById('open')!)).toBe(true)
    expect(isComposerRow(document.getElementById('composer')!)).toBe(true)
  })

  it('treats a header as off-top when its bottom meets the scrollport top', () => {
    document.body.innerHTML = '<div data-disclosure-row id="row"></div>'
    const row = document.getElementById('row')!
    row.getBoundingClientRect = () => rect(-10, 0) as DOMRect
    expect(isOffTop(row, rect(0, 400))).toBe(true)
    row.getBoundingClientRect = () => rect(20, 40) as DOMRect
    expect(isOffTop(row, rect(0, 400))).toBe(false)
  })
})
