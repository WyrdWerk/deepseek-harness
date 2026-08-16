// @vitest-environment jsdom
/**
 * Sticky-disclosure hotkey helpers: persist, label, and match.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOTKEY,
  HOTKEY_STORAGE_KEY,
  keyLabel,
  labelOfHotkey,
  loadHotkey,
  matchesHotkey,
  normalizeHotkey,
  saveHotkey,
} from '../src/client/hotkey.ts'

describe('normalizeHotkey', () => {
  it('accepts a complete spec and rejects unusable values', () => {
    expect(normalizeHotkey(null)).toBeNull()
    expect(normalizeHotkey('KeyC')).toBeNull()
    expect(normalizeHotkey({ ctrl: true, code: '' })).toBeNull()
    expect(normalizeHotkey({ ctrl: true, code: 'Escape' })).toBeNull()
    expect(normalizeHotkey({ code: 'KeyC' })).toBeNull()
    expect(normalizeHotkey({
      ctrl: true, meta: 1, alt: false, shift: 'yes', code: 'KeyK',
    })).toEqual({
      ctrl: true, meta: false, alt: false, shift: false, code: 'KeyK',
    })
  })
})

describe('keyLabel / labelOfHotkey', () => {
  it('labels letters, digits, named keys, and unknown codes', () => {
    expect(keyLabel('KeyC')).toBe('C')
    expect(keyLabel('Digit7')).toBe('7')
    expect(keyLabel('ArrowUp')).toBe('↑')
    expect(keyLabel('F8')).toBe('F8')
  })

  it('joins modifiers for Windows and macOS', () => {
    const spec = { ctrl: true, meta: true, alt: true, shift: true, code: 'KeyC' }
    expect(labelOfHotkey(spec, false)).toBe('Ctrl+Meta+Alt+Shift+C')
    expect(labelOfHotkey(spec, true)).toBe('⌃+⌘+⌥+⇧+C')
    expect(labelOfHotkey(DEFAULT_HOTKEY, false)).toBe('Ctrl+Alt+C')
    expect(labelOfHotkey({
      ctrl: false, meta: true, alt: false, shift: false, code: 'KeyK',
    }, true)).toBe('⌘+K')
  })
})

describe('loadHotkey / saveHotkey', () => {
  it('loads a stored spec and falls back on corrupt or empty storage', () => {
    const map = new Map<string, string>()
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value) },
    }
    expect(loadHotkey(storage)).toEqual(DEFAULT_HOTKEY)
    map.set(HOTKEY_STORAGE_KEY, '{')
    expect(loadHotkey(storage)).toEqual(DEFAULT_HOTKEY)
    map.set(HOTKEY_STORAGE_KEY, JSON.stringify({ code: 'KeyC' }))
    expect(loadHotkey(storage)).toEqual(DEFAULT_HOTKEY)
    saveHotkey(storage, { ctrl: false, meta: true, alt: false, shift: true, code: 'KeyK' })
    expect(loadHotkey(storage)).toEqual({
      ctrl: false, meta: true, alt: false, shift: true, code: 'KeyK',
    })
  })

  it('swallows a storage write failure', () => {
    expect(() => saveHotkey({
      setItem: () => { throw new Error('quota') },
    }, DEFAULT_HOTKEY)).not.toThrow()
  })
})

describe('matchesHotkey', () => {
  const spec = DEFAULT_HOTKEY

  it('matches the default combo and refuses composing, AltGraph, and mismatches', () => {
    const hit = new KeyboardEvent('keydown', {
      code: 'KeyC', ctrlKey: true, altKey: true, bubbles: true,
    })
    expect(matchesHotkey(hit, spec)).toBe(true)
    const composing = new KeyboardEvent('keydown', {
      code: 'KeyC', ctrlKey: true, altKey: true, bubbles: true,
    })
    Object.defineProperty(composing, 'isComposing', { value: true })
    expect(matchesHotkey(composing, spec)).toBe(false)
    const altGraph = new KeyboardEvent('keydown', {
      code: 'KeyC', ctrlKey: true, altKey: true, bubbles: true,
    })
    Object.defineProperty(altGraph, 'getModifierState', {
      value: (name: string) => name === 'AltGraph',
    })
    expect(matchesHotkey(altGraph, spec)).toBe(false)
    expect(matchesHotkey(new KeyboardEvent('keydown', { code: 'KeyX', ctrlKey: true, altKey: true }), spec)).toBe(false)
    expect(matchesHotkey(new KeyboardEvent('keydown', { code: 'KeyC', ctrlKey: true }), spec)).toBe(false)
    const prevented = new KeyboardEvent('keydown', {
      code: 'KeyC', ctrlKey: true, altKey: true, bubbles: true, cancelable: true,
    })
    prevented.preventDefault()
    expect(matchesHotkey(prevented, spec)).toBe(false)
  })
})
