/** Pure page-projection and usability predicates over the shared Models join. */
import { describe, expect, it } from 'vitest'
import type { CredentialView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ProviderRow } from '../src/client/store.ts'
import { providerUsable } from '../src/client/store.ts'
import { pageVisibleProvider } from '../src/client/ModelsSection.tsx'

const missingCredential: CredentialView = { configured: false, writable: true }

/** The official DeepSeek route the overlay hides from the page. */
function officialRow(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    entry: {
      provider: 'deepseek-official',
      displayName: 'DeepSeek',
      settingsNs: 'llm-deepseek',
      settingsPath: [],
      active: true,
    },
    configured: true,
    removable: false,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    credential: missingCredential,
    ...overrides,
  }
}

/** A pi-ai route the user configured themselves. */
function piAiRow(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    entry: {
      provider: 'hfai',
      displayName: 'HFAI',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'hfai'],
      active: true,
    },
    configured: true,
    removable: true,
    apiKeyEnv: 'HFAI_API_KEY',
    credential: { configured: true, source: 'file', writable: true },
    ...overrides,
  }
}


describe('providerUsable', () => {
  it('requires a registered route and a stored key for every named reference', () => {
    expect(providerUsable(officialRow({ credential: undefined }))).toBe(false)
    expect(providerUsable(officialRow({ credential: missingCredential }))).toBe(false)
    expect(providerUsable(officialRow({
      credential: { configured: true, source: 'file', writable: true },
    }))).toBe(true)
  })

  it('treats a reference-free registered route as provider-native authentication', () => {
    expect(providerUsable(piAiRow({ apiKeyEnv: undefined, credential: undefined }))).toBe(true)
  })
})

describe('pageVisibleProvider', () => {
  it('hides official DeepSeek rows so the page cannot open an inert editor', () => {
    expect(pageVisibleProvider(officialRow())).toBe(false)
  })

  it('hides any row whose settings namespace is llm-deepseek even under a different provider id', () => {
    expect(pageVisibleProvider({
      ...officialRow(),
      entry: { ...officialRow().entry, provider: 'renamed', settingsNs: 'llm-deepseek' },
    })).toBe(false)
  })

  it('shows pi-ai rows so first-run setup is never suppressed by hidden official rows', () => {
    expect(pageVisibleProvider(piAiRow())).toBe(true)
  })

  it('shows custom-provider rows on unknown namespaces', () => {
    expect(pageVisibleProvider({
      ...piAiRow(),
      entry: { ...piAiRow().entry, provider: 'custom', settingsNs: 'llm-custom' },
    })).toBe(true)
  })
})
