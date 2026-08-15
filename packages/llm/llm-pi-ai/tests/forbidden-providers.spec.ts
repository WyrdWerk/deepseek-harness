import { describe, expect, it } from 'vitest'
import { getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'
import { catalogProvider, catalogProviderIds, resolveRouteModels } from '../src/catalog.ts'

// The provider route keys this overlay refuses to serve. `resolveRouteModels`
// throws before reading any field besides `provider`, so the request objects
// below carry only what the type requires — nothing here reaches the network.
const FORBIDDEN: readonly string[] = ['deepseek', 'deepseek-official']

describe('forbidden provider routes', () => {
  it('rejects the official DeepSeek route keys at catalog resolution', () => {
    for (const provider of FORBIDDEN) {
      expect(() => resolveRouteModels({
        provider,
        defaultContextWindow: 8192,
        defaultMaxTokens: 1024,
        defaultInput: ['text'],
      })).toThrow(`llm-pi-ai: provider "${provider}"`)
    }
  })

  it('strips the forbidden ids from the installed catalog', () => {
    const ids = catalogProviderIds()
    for (const provider of FORBIDDEN) {
      expect(ids).not.toContain(provider)
      expect(catalogProvider(provider)).toBeUndefined()
    }
  })

  it('drops only the forbidden ids, preserving every other route', () => {
    // The filtered catalog equals the builtin catalog minus exactly the
    // forbidden keys — proof the filter is surgical, not a broader suppression.
    expect([...catalogProviderIds()])
      .toEqual(getBuiltinProviders().filter(id => !FORBIDDEN.includes(id)))
  })
})
