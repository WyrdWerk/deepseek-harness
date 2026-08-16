/**
 * Persisted collapse-all hotkey. Stored in localStorage as JSON; never
 * sent to the host.
 */

/** One modifier-plus-key combination. */
export interface HotkeySpec {
  /** Control / Ctrl. */
  ctrl: boolean
  /** Meta / Command. */
  meta: boolean
  /** Alt / Option. */
  alt: boolean
  /** Shift. */
  shift: boolean
  /** KeyboardEvent.code, e.g. `KeyC`. */
  code: string
}

/** Default: Ctrl+Alt+C (⌘⌥C on macOS). */
export const DEFAULT_HOTKEY: HotkeySpec = {
  ctrl: true,
  meta: false,
  alt: true,
  shift: false,
  code: 'KeyC',
}

/** localStorage key for the JSON spec. */
export const HOTKEY_STORAGE_KEY = 'dsh-client-ui-sticky-disclosure:hotkey'

/**
 * Accept a raw storage value as a hotkey, or return null.
 * Escape is reserved for dialogs; a combo needs Ctrl, Meta, or Alt so it
 * cannot collide with ordinary typing.
 * @param raw - parsed JSON or an in-progress capture payload.
 * @returns a normalized spec, or null when the value is unusable.
 */
export function normalizeHotkey(raw: unknown): HotkeySpec | null {
  if (raw === null || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (typeof record.code !== 'string' || record.code === '') return null
  if (record.code === 'Escape') return null
  if (!(record.ctrl === true || record.meta === true || record.alt === true)) return null
  return {
    ctrl: record.ctrl === true,
    meta: record.meta === true,
    alt: record.alt === true,
    shift: record.shift === true,
    code: record.code,
  }
}

/**
 * Human-readable label for a KeyboardEvent.code.
 * @param code - event.code.
 * @returns a short glyph or letter.
 */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  const named: Record<string, string> = {
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    BracketLeft: '[',
    BracketRight: ']',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Delete: 'Del',
    Backspace: '⌫',
  }
  return named[code] ?? code
}

/**
 * Display label for a hotkey (e.g. `Ctrl+Alt+C`, `⌘⌥C`).
 * @param spec - the active combination.
 * @param mac - whether to use Apple modifier glyphs.
 * @returns the joined label.
 */
export function labelOfHotkey(spec: HotkeySpec, mac: boolean): string {
  const parts: string[] = []
  if (spec.ctrl) parts.push(mac ? '⌃' : 'Ctrl')
  if (spec.meta) parts.push(mac ? '⌘' : 'Meta')
  if (spec.alt) parts.push(mac ? '⌥' : 'Alt')
  if (spec.shift) parts.push(mac ? '⇧' : 'Shift')
  parts.push(keyLabel(spec.code))
  return parts.join('+')
}

/**
 * Load the persisted hotkey, falling back to the default.
 * @param storage - localStorage or a test double.
 * @returns a usable spec.
 */
export function loadHotkey(storage: Pick<Storage, 'getItem'>): HotkeySpec {
  try {
    const spec = normalizeHotkey(JSON.parse(storage.getItem(HOTKEY_STORAGE_KEY) ?? 'null'))
    if (spec !== null) return spec
  } catch {
    /* corrupt storage falls back */
  }
  return { ...DEFAULT_HOTKEY }
}

/**
 * Persist the hotkey (best-effort; private mode may throw).
 * @param storage - localStorage or a test double.
 * @param spec - the spec to store.
 */
export function saveHotkey(storage: Pick<Storage, 'setItem'>, spec: HotkeySpec): void {
  try {
    storage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(spec))
  } catch {
    /* non-persistent; still works for this page lifetime */
  }
}

/**
 * Whether a keydown matches the active hotkey.
 * @param event - the keydown.
 * @param spec - the active combination.
 * @returns true when the event should collapse every expanded section.
 */
export function matchesHotkey(event: KeyboardEvent, spec: HotkeySpec): boolean {
  if (event.defaultPrevented) return false
  if (event.isComposing) return false
  if (event.code !== spec.code) return false
  if (event.ctrlKey !== spec.ctrl || event.metaKey !== spec.meta
    || event.altKey !== spec.alt || event.shiftKey !== spec.shift) return false
  if (event.getModifierState('AltGraph')) return false
  return true
}
