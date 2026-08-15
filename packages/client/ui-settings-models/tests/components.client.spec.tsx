// @vitest-environment jsdom
/** Section, setup-card, and hand-written editor behavior over a scripted wire face. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@deepseek-ai/schemastery'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import type { RpcResponse, SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import {
  ModelsSection, needsSetup, providerCopy, providerTargetLabel,
} from '../src/client/ModelsSection.tsx'
import type { ModelsSectionInjected, ModelsSectionProps } from '../src/client/ModelsSection.tsx'
import { pathOps } from '../src/client/ProviderEditor.tsx'
import { ModelListEditor } from '../src/client/ModelListEditor.tsx'
import { apiKeyFailure } from '../src/client/apiKey.ts'
import { ModelsSettingsStore } from '../src/client/store.ts'
import type { ProviderRow } from '../src/client/store.ts'
import { formatCapacity, modelDrafts, parseCapacity, validateModelCatalog } from '../src/client/model-fields.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: ModelsSectionInjected['t'] = key => en[key]
const OPENAI_TARGET = { provider: 'openai', displayName: 'openai' }
const openaiCopy = (template: string): string => providerCopy(template, OPENAI_TARGET)

function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${Date.now()}` as never, result: { ok: true, value } }
}

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    baseURL: Schema.string(),
    reasoning: Schema.union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
    headers: Schema.dict(Schema.string()),
    models: Schema.array(Schema.object({
      id: Schema.string().required(),
      name: Schema.string(),
      contextWindow: Schema.number().step(1).min(1),
      maxTokens: Schema.number().step(1).min(1),
    })).default([
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 1_000_000, maxTokens: 256_000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 1_000_000, maxTokens: 256_000 },
    ]),
  })),
})

const DEFAULT_OPENAI_MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Preserved hidden detail', contextWindow: 1_000_000, maxTokens: 256_000 },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 1_000_000, maxTokens: 256_000 },
]

function wireNamespaces(): SettingsNamespaceView[] {
  return [
    {
      ns: 'llm-plain',
      schema: JSON.parse(JSON.stringify(Schema.object({
        profiles: Schema.dict(Schema.object({ note: Schema.string() })),
      }).toJSON())) as unknown,
      value: {},
      applies: 'live',
      secrets: [],
      revision: 0,
    },
    {
      ns: 'llm-pi-ai',
      schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as unknown,
      value: {
        providers: {
          openai: {
            apiKeyEnv: 'OPENAI_API_KEY',
            baseURL: 'https://base',
            headers: { 'X-Team': 'a' },
            models: DEFAULT_OPENAI_MODELS,
          },
          zombie: {},
        },
      },
      base: {
        providers: {
          openai: { models: DEFAULT_OPENAI_MODELS },
        },
      },
      user: {
        providers: {
          openai: {
            apiKeyEnv: 'OPENAI_API_KEY',
            baseURL: 'https://base',
            headers: { 'X-Team': 'a' },
          },
          zombie: {},
        },
      },
      applies: 'live',
      secrets: [],
      revision: 0,
    },
  ]
}

function scriptedFace(overrides: {
  update?: ReturnType<typeof vi.fn>
  replace?: ReturnType<typeof vi.fn>
  mutate?: ReturnType<typeof vi.fn>
  set?: ReturnType<typeof vi.fn>
  unset?: ReturnType<typeof vi.fn>
} = {}) {
  const update = overrides.update ?? vi.fn(() => Promise.resolve(ok(wireNamespaces()[1])))
  const replace = overrides.replace ?? vi.fn(() => Promise.resolve(ok(wireNamespaces()[1])))
  const mutate = overrides.mutate ?? vi.fn(() => Promise.resolve(ok(wireNamespaces()[1])))
  const set = overrides.set ?? vi.fn(() => Promise.resolve(ok({})))
  const unset = overrides.unset ?? vi.fn(() => Promise.resolve(ok({})))
  const face = {
    llm: {
      providers: vi.fn(() => Promise.resolve(ok({
        providers: [
          { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: true },
          { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], active: false },
          { provider: 'zombie', displayName: 'zombie', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'zombie'], active: false },
          { provider: 'broken', displayName: 'broken', settingsNs: 'llm-pi-ai', settingsPath: ['nope', 'x'], active: false },
          { provider: 'plain', displayName: 'plain', settingsNs: 'llm-plain', settingsPath: ['profiles', 'plain'], active: false },
        ],
      }))),
      models: vi.fn(() => Promise.resolve(ok({ groups: [], failures: [] }))),
      discoverModels: vi.fn(() => Promise.resolve(ok({ models: [] }))),
    },
    settings: {
      describe: vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: wireNamespaces() }))),
      update,
      replace,
      mutate,
    },
    credentials: {
      describe: vi.fn((payload: { refs: string[] }) => Promise.resolve(ok({
        credentials: Object.fromEntries(payload.refs.map(ref => [ref, {
          configured: ref === 'OPENAI_API_KEY',
          ...ref === 'OPENAI_API_KEY' ? { source: 'file' } : {},
          writable: true,
        }])),
      }))),
      set,
      unset,
    },
  }
  return { face, update, replace, mutate, set, unset }
}

type WireFace = ConstructorParameters<typeof ModelsSettingsStore>[0]

async function mountFace(scripted: ReturnType<typeof scriptedFace>) {
  const { face, update, replace, mutate, set, unset } = scripted
  const controller = new ModelsSettingsStore(face as unknown as WireFace)
  await controller.load()
  const injected: ModelsSectionInjected = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    api: face as never,
    t,
  }
  const view = render(<ModelsSection {...injected} />)
  return { view, face, update, replace, mutate, set, unset, controller }
}

async function mountSection(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  return mountFace(scriptedFace(overrides))
}

async function mountOpenAICard(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  const mounted = await mountSection(overrides)
  fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
  return mounted
}

describe('ModelsSection', () => {
  it('renders nothing before the slot injects its dependencies', () => {
    const uninjected = {} as ModelsSectionProps
    render(<ModelsSection {...uninjected} />)
    expect(document.body.textContent).toBe('')
  })

  it('shows providers as rows in the first-run posture without auto-opening any card', async () => {
    const { face } = scriptedFace()
    face.credentials.describe.mockImplementation((payload: { refs: string[] }) => Promise.resolve(ok({
      credentials: Object.fromEntries(payload.refs.map(ref => [ref, { configured: false, writable: true }])),
    })))
    await mountFace({ face, update: vi.fn(), replace: vi.fn(), mutate: vi.fn(), set: vi.fn(), unset: vi.fn() })
    expect(screen.getByText('openai')).toBeTruthy()
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
    expect(screen.getByText(en.add)).toBeTruthy()
  })

  it('shows the configured provider with a dot and opens its editor on request', async () => {
    await mountSection()
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
    const configured = screen.getByRole('img', { name: en.credentialConfigured })
    expect(configured.getAttribute('title')).toBe(en.credentialConfigured)
    expect(configured.closest('li')?.textContent).toContain('openai')
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    expect(screen.getByLabelText(en.keyInput)).toBeTruthy()
  })

  it('marks only a confirmed missing reference and leaves native or unavailable state unmarked', async () => {
    const { face } = scriptedFace()
    face.credentials.describe.mockImplementation((payload: { refs: string[] }) => Promise.resolve(ok({
      credentials: Object.fromEntries(payload.refs.map(ref => [ref, { configured: false, writable: true }])),
    })))
    const controller = new ModelsSettingsStore(face as unknown as WireFace)
    await controller.load()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face as never}
      t={t}
    />)
    const missing = screen.getByRole('img', { name: en.credentialMissing })
    expect(missing.getAttribute('title')).toBe(en.credentialMissing)
    expect(missing.closest('li')?.textContent).toContain('openai')
    expect(screen.queryByRole('img', { name: en.credentialConfigured })).toBeNull()
  })

  it('decides setup need from the joined credential state and the first-run posture', () => {
    const entry = { provider: 'p', displayName: 'p', settingsNs: 'llm-pi-ai', settingsPath: [], active: true }
    const row = (credential: ProviderRow['credential']): ProviderRow => ({
      entry, configured: true, removable: false, apiKeyEnv: 'X', credential,
    })
    expect(needsSetup(row(undefined), false)).toBe(true)
    expect(needsSetup(row({ configured: true, writable: true }), false)).toBe(false)
    const nested = { ...row(undefined), entry: { ...entry, settingsPath: ['providers', 'x'] } }
    expect(needsSetup(nested, false)).toBe(false)
    expect(needsSetup(row(undefined), true)).toBe(false)
  })

  it('uses one stable provider identity in action copy', () => {
    const target = { provider: 'openai', displayName: 'OpenAI' }
    expect(providerTargetLabel(target)).toBe('OpenAI (openai)')
    expect(providerCopy(en.deleteTitle, target)).toBe('Delete OpenAI (openai)?')
    expect(providerTargetLabel(OPENAI_TARGET)).toBe('openai')
  })

  it('names only changed fields instead of rebuilding the section', () => {
    expect(pathOps(['providers', 'openai'], { baseURL: 'https://old', reasoning: 'high' }, { reasoning: 'high' }))
      .toEqual([{ op: 'unset', path: ['providers', 'openai', 'baseURL'] }])
    expect(pathOps([], { b: 1 }, { b: 2, d: 3 }))
      .toEqual([{ op: 'set', path: ['b'], value: 2 }, { op: 'set', path: ['d'], value: 3 }])
    expect(pathOps([], undefined, {})).toEqual([])
    expect(pathOps([], { a: 1 }, { a: 1 })).toEqual([])
  })

  it('stores a typed key write-only from the editor without touching settings', async () => {
    const { set, update } = await mountOpenAICard()
    const key = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    fireEvent.change(key, { target: { value: '  sk-live  ' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(set).toHaveBeenCalledWith({ ref: 'OPENAI_API_KEY', value: 'sk-live' }) })
    expect(update).not.toHaveBeenCalled()
    expect((await screen.findByRole('status')).textContent).toContain('openai')
  })

  it('applies customized provider fields as path ops', async () => {
    const { mutate } = await mountOpenAICard({
      mutate: vi.fn(() => Promise.resolve(ok(wireNamespaces()[1]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    const baseURL = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    expect(baseURL.placeholder).toBe('https://base')
    fireEvent.change(baseURL, { target: { value: 'https://next2' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{ op: 'set', path: ['providers', 'openai', 'baseURL'], value: 'https://next2' }],
      expectedRevision: 0,
    })
  })

  it('materializes inherited models and adds an arbitrary model id', async () => {
    const { mutate } = await mountOpenAICard({
      mutate: vi.fn(() => Promise.resolve(ok(wireNamespaces()[1]))),
    })
    fireEvent.click(screen.getByText(en.customized))
    expect(screen.getByText(en.modelsInherited)).toBeTruthy()
    expect(screen.getAllByLabelText(new RegExp(en.modelId)).map(input => (input as HTMLInputElement).value))
      .toEqual(['gpt-4o', 'gpt-4o-mini'])

    fireEvent.click(screen.getByText(en.addModel))
    const ids = screen.getAllByLabelText(new RegExp(en.modelId))
    const names = screen.getAllByLabelText(new RegExp(en.modelName))
    fireEvent.click(screen.getByLabelText(`${en.modelAdvanced} 3`))
    fireEvent.change(ids[2] as HTMLInputElement, { target: { value: 'private-preview' } })
    fireEvent.change(names[2] as HTMLInputElement, { target: { value: 'Private Preview' } })
    fireEvent.change(screen.getByLabelText(`${en.contextWindow} 3`), { target: { value: '131072' } })
    fireEvent.click(screen.getByText(en.apply))

    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{
        op: 'set',
        path: ['providers', 'openai', 'models'],
        value: [
          ...DEFAULT_OPENAI_MODELS,
          { id: 'private-preview', name: 'Private Preview', contextWindow: 131_072 },
        ],
      }],
      expectedRevision: 0,
    })
  })

  it('rejects duplicate model ids before writing', async () => {
    const { mutate } = await mountOpenAICard()
    fireEvent.click(screen.getByText(en.customized))
    fireEvent.click(screen.getByText(en.addModel))
    const ids = screen.getAllByLabelText(new RegExp(en.modelId))
    fireEvent.change(ids[2] as HTMLInputElement, { target: { value: 'gpt-4o' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(`Model 3: ${en.modelIdDuplicate}`)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('refuses whitespace-only and padded-duplicate model ids', () => {
    expect(validateModelCatalog([{ id: '   ' }])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateModelCatalog([{ id: 'model' }, { id: 'model ' }]))
      .toEqual({ index: 1, key: 'modelIdDuplicate' })
  })

  it('clears an inherited override with an unset op, never a whole-section replace', async () => {
    const { replace, update, mutate } = await mountOpenAICard()
    fireEvent.click(screen.getByText(en.customized))
    const url = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    expect(url.value).toBe('https://base')
    fireEvent.change(url, { target: { value: '' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(replace).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{ op: 'unset', path: ['providers', 'openai', 'baseURL'] }],
      expectedRevision: 0,
    })
  })

  it('edits a pi-ai profile with the curated fields only', async () => {
    await mountOpenAICard()
    const editorKey = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    expect(editorKey.placeholder).toContain('Configured')
    expect(screen.getByText(en.customized)).toBeTruthy()
    expect(screen.getByLabelText(en.baseUrl)).toBeTruthy()
    expect(screen.getByText(en.modelsInherited)).toBeTruthy()
  })

  it('renders malformed draft fallbacks without inventing catalog values', () => {
    const { face } = scriptedFace()
    render(<ModelListEditor
      models={[{}]}
      overridden={false}
      t={t}
      disabled={false}
      onChange={vi.fn()}
      onReset={vi.fn()}
      probe={{ settingsNs: 'llm-pi-ai', provider: 'openai' }}
      api={face as never}
    />)
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`).value).toBe('')
  })

  it('keeps the card usable when the write rejects instead of answering', async () => {
    await mountOpenAICard({ mutate: vi.fn(() => Promise.reject(new Error('connection lost'))) })
    fireEvent.click(screen.getByText(en.customized))
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.baseUrl), { target: { value: 'https://next' } })
    fireEvent.click(screen.getByText(en.apply))
    expect(screen.getByLabelText(en.baseUrl)).toBeTruthy()
  })
})

describe('ModelListEditor', () => {
  it('validates every adapter-owned model catalog invariant', () => {
    expect(modelDrafts(undefined)).toEqual([])
    expect(modelDrafts([null, 'bad', { id: 'ok' }])).toEqual([{}, {}, { id: 'ok' }])
    expect(validateModelCatalog([{}])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateModelCatalog([{ id: 'same' }, { id: 'same' }]))
      .toEqual({ index: 1, key: 'modelIdDuplicate' })
    expect(validateModelCatalog([{ id: 'model', name: '' }]))
      .toEqual({ index: 0, key: 'modelNameInvalid' })
    expect(validateModelCatalog([{ id: 'model', contextWindow: null }]))
      .toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateModelCatalog([{ id: 'model', contextWindow: 1 }])).toBeUndefined()
    expect(validateModelCatalog([{ id: 'model', maxTokens: null }]))
      .toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
  })

  it('reads context windows written as counts, thousands, or millions', () => {
    expect(parseCapacity('')).toBeUndefined()
    expect(parseCapacity('128000')).toBe(128_000)
    expect(parseCapacity('128K')).toBe(128_000)
    expect(parseCapacity('1M')).toBe(1_000_000)
    expect(formatCapacity(1_000_000)).toBe('1M')
    expect(formatCapacity(256_000)).toBe('256K')
  })
})

describe('apiKeyFailure', () => {
  it('treats a blank field as no failure — it means keep the stored key', () => {
    expect(apiKeyFailure('')).toBeUndefined()
  })
})
