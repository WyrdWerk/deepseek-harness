/** `stickyDisclosure` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.aria': '收起 {label}',
  'chip.title': '点击收起 · {hotkey} 收起全部',
  'control.label': '全部收起',
  'control.aria': '收起全部展开区块',
  'control.title': '收起全部展开区块 · {hotkey}',
  'gear.aria': '收起快捷键设置',
  'panel.title': '收起全部快捷键',
  'panel.close': '关闭',
  'panel.set': '设置',
  'panel.capturing': '请按新组合键…',
  'panel.reset': '恢复默认',
  'panel.hint': '快捷键对本页面持久生效，仅存于浏览器本地。',
  'panel.hintCapture': '按下新的组合键（需含 Ctrl/⌘/Alt 之一）… 按 Esc 取消',
  'section.fallback': '区块',
} satisfies Record<string, string>

/** The sticky-disclosure namespace key union. */
export type StickyDisclosureKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Collapse-all overlay copy. */
    stickyDisclosure: StickyDisclosureKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'chip.aria': 'Collapse {label}',
  'chip.title': 'Click to collapse · {hotkey} collapses all',
  'control.label': 'Collapse all',
  'control.aria': 'Collapse every expanded section',
  'control.title': 'Collapse every expanded section · {hotkey}',
  'gear.aria': 'Collapse-all shortcut settings',
  'panel.title': 'Collapse-all shortcut',
  'panel.close': 'Close',
  'panel.set': 'Set',
  'panel.capturing': 'Press the new combination…',
  'panel.reset': 'Restore default',
  'panel.hint': 'The shortcut persists for this origin in the browser only.',
  'panel.hintCapture': 'Press a combination that includes Ctrl, ⌘, or Alt… Esc cancels',
  'section.fallback': 'Section',
} satisfies Record<StickyDisclosureKey, string>
