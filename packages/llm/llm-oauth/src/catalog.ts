/**
 * Dynamic model catalogs for the OAuth providers: each provider's own
 * listing endpoint, mapped onto pi-ai `Model` objects and mounted as a
 * `fetchModels` overlay so `Models.refreshModels()` restores the cached list
 * from disk, refreshes the OAuth credential, re-fetches when stale, and
 * keeps the picker current without a plugin upgrade.
 *
 * Endpoints (verified live 2026-08-15):
 * - `openai-codex`: `GET https://chatgpt.com/backend-api/codex/models?client_version=<v>`
 *   with Bearer + `chatgpt-account-id` + `OpenAI-Beta: responses=v1` +
 *   `originator: codex_cli_rs`. Entries carry `slug`, `display_name`,
 *   `input_modalities`, `context_window`, `supported_reasoning_levels`
 *   (`effort` ids incl. minimal/max/ultra), `visibility`, `supported_in_api`,
 *   and `minimal_client_version` — hidden or too-new entries are filtered.
 * - `xai`: `GET https://api.x.ai/v1/models` with Bearer. Entries carry `id`,
 *   `aliases`, `context_length`, and per-modality pricing; image pricing
 *   present means image input.
 *
 * @module dsh-llm-oauth/catalog
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { RefreshModelsContext } from '@earendil-works/pi-ai'
import type { Api, Model, ModelsStore, ModelsStoreEntry } from '@earendil-works/pi-ai'

/** Reasoning efforts the harness vocabulary can express; `ultra` clamps to `max`. */
const KNOWN_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])

/** Zero cost for a listing that names no price: absence of a fact. */
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const

/** Codex listing entry (subset this mapper reads). */
interface CodexListModel {
  slug?: unknown
  display_name?: unknown
  description?: unknown
  input_modalities?: unknown
  context_window?: unknown
  supported_reasoning_levels?: unknown
  default_reasoning_level?: unknown
  visibility?: unknown
  supported_in_api?: unknown
  minimal_client_version?: unknown
}

/** xAI listing entry (subset this mapper reads). */
interface XaiListModel {
  id?: unknown
  context_length?: unknown
  prompt_image_token_price?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Compare two dotted version strings numerically; missing segments are zero. */
function versionAtLeast(actual: string | undefined, required: string | undefined): boolean {
  if (required === undefined || required.length === 0) return true
  const left = (actual ?? '').split('.').map(part => Number.parseInt(part, 10) || 0)
  const right = required.split('.').map(part => Number.parseInt(part, 10) || 0)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = left[index] ?? 0
    const r = right[index] ?? 0
    if (l !== r) return l > r
  }
  return true
}

/** Map codex `supported_reasoning_levels` onto pi-ai's `thinkingLevelMap`. */
function codexThinkingMap(levels: unknown): Partial<Record<string, string | null>> | undefined {
  if (!Array.isArray(levels)) return undefined
  const map: Record<string, string | null> = {}
  let count = 0
  for (const raw of levels) {
    const effort = isRecord(raw) && typeof raw.effort === 'string' ? raw.effort : undefined
    if (effort === undefined || !KNOWN_EFFORTS.has(effort)) continue
    if (effort === 'ultra') {
      // The harness vocabulary tops out at max; ultra is the provider's max.
      if (map.max === undefined) map.max = 'max'
    } else if (effort === 'minimal') {
      // Catalog convention: minimal is selectable, the wire says low.
      map.minimal = 'low'
    } else {
      map[effort] = effort
    }
    count += 1
  }
  return count > 0 ? map : undefined
}

/** GET one JSON document with a bounded size and sane errors. */
async function getJson(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: 'application/json', ...headers },
    ...signal === undefined ? {} : { signal },
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`GET ${url} -> HTTP ${response.status}: ${body.slice(0, 200)}`)
  }
  return response.json()
}

/**
 * Fetch the ChatGPT Codex model list and map it to pi-ai models.
 * @param clientVersion - codex CLI version to claim; gates entries whose
 *   `minimal_client_version` is newer.
 * @returns the mapped catalog in endpoint priority order.
 */
export async function fetchCodexModels(
  context: RefreshModelsContext,
  clientVersion: string,
): Promise<readonly Model<Api>[]> {
  const credential = context.credential
  const token = isRecord(credential) && typeof credential.access === 'string' ? credential.access : undefined
  const accountId = isRecord(credential) && typeof credential.accountId === 'string' ? credential.accountId : undefined
  if (token === undefined) throw new Error('codex model listing requires the stored OAuth credential')
  const url = `https://chatgpt.com/backend-api/codex/models?client_version=${encodeURIComponent(clientVersion)}`
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    'openai-beta': 'responses=v1',
    originator: 'codex_cli_rs',
    'user-agent': 'codex_cli_rs',
    ...(accountId === undefined ? {} : { 'chatgpt-account-id': accountId }),
  }
  const payload = await getJson(url, headers, context.signal)
  const entries = isRecord(payload) && Array.isArray(payload.models) ? payload.models as CodexListModel[] : []
  const models: Model<Api>[] = []
  for (const entry of entries) {
    const id = typeof entry.slug === 'string' ? entry.slug : undefined
    if (id === undefined) continue
    if (entry.visibility !== undefined && entry.visibility !== 'list') continue
    if (entry.supported_in_api === false) continue
    if (!versionAtLeast(clientVersion, typeof entry.minimal_client_version === 'string' ? entry.minimal_client_version : undefined)) continue
    const input = Array.isArray(entry.input_modalities)
      ? entry.input_modalities.filter((m): m is 'text' | 'image' => m === 'text' || m === 'image')
      : ['text'] as ('text' | 'image')[]
    const contextWindow = typeof entry.context_window === 'number' && entry.context_window > 0 ? entry.context_window : 128_000
    const thinking = codexThinkingMap(entry.supported_reasoning_levels)
    models.push({
      id,
      name: typeof entry.display_name === 'string' && entry.display_name.length > 0 ? entry.display_name : id,
      ...(typeof entry.description === 'string' && entry.description.length > 0 ? { description: entry.description } : {}),
      provider: 'openai-codex',
      api: 'openai-codex-responses',
      baseUrl: 'https://chatgpt.com/backend-api',
      reasoning: Array.isArray(entry.supported_reasoning_levels) && entry.supported_reasoning_levels.length > 0,
      input: input.length > 0 ? input : ['text'],
      cost: NO_COST,
      contextWindow,
      maxTokens: Math.min(128_000, contextWindow),
      ...thinking === undefined ? {} : { thinkingLevelMap: thinking },
    })
  }
  return models
}

/**
 * Fetch the xAI model list and map it to pi-ai models on the completions
 * protocol (the one every listed xAI model serves), reasoning on by default
 * exactly like the shipped catalog's grok entries.
 * @returns the mapped catalog in endpoint order.
 */
export async function fetchXaiModels(context: RefreshModelsContext): Promise<readonly Model<Api>[]> {
  const credential = context.credential
  const token = isRecord(credential) && typeof credential.access === 'string' ? credential.access : undefined
  if (token === undefined) throw new Error('xai model listing requires the stored OAuth credential')
  const payload = await getJson('https://api.x.ai/v1/models', {
    authorization: `Bearer ${token}`,
  }, context.signal)
  const entries = isRecord(payload) && Array.isArray(payload.data) ? payload.data as XaiListModel[] : []
  const models: Model<Api>[] = []
  for (const entry of entries) {
    const id = typeof entry.id === 'string' ? entry.id : undefined
    if (id === undefined) continue
    const contextWindow = typeof entry.context_length === 'number' && entry.context_length > 0
      ? entry.context_length
      : 131_072
    const hasImage = typeof entry.prompt_image_token_price === 'number' && entry.prompt_image_token_price > 0
    models.push({
      id,
      name: id,
      provider: 'xai',
      api: 'openai-completions',
      baseUrl: 'https://api.x.ai/v1',
      reasoning: true,
      input: hasImage ? ['text', 'image'] : ['text'],
      cost: NO_COST,
      contextWindow,
      maxTokens: Math.min(131_072, contextWindow),
    })
  }
  return models
}

/** A `ModelsStore` persisted as one JSON file, entries keyed by provider id. */
export class JsonFileModelsStore implements ModelsStore {
  readonly path: string
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(path: string) {
    this.path = path
  }

  private async load(): Promise<Record<string, ModelsStoreEntry>> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch {
      return {}
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      return isRecord(parsed) ? parsed as Record<string, ModelsStoreEntry> : {}
    } catch {
      // A corrupt cache must never take the route down; start over.
      return {}
    }
  }

  private async persist(entries: Record<string, ModelsStoreEntry>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
    await writeFile(tmp, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 })
    await rename(tmp, this.path)
  }

  private serialize<T>(key: string, run: () => Promise<T>): Promise<T> {
    const prior = this.chains.get(key) ?? Promise.resolve()
    const next = prior.then(run, run)
    const settled = next.then(() => undefined, () => undefined)
    this.chains.set(key, settled)
    void settled.then(() => {
      if (this.chains.get(key) === settled) this.chains.delete(key)
    })
    return next
  }

  read(providerId: string): Promise<ModelsStoreEntry | undefined> {
    return this.serialize(providerId, async () => (await this.load())[providerId])
  }

  write(providerId: string, entry: ModelsStoreEntry): Promise<void> {
    return this.serialize(providerId, async () => {
      const entries = await this.load()
      entries[providerId] = entry
      await this.persist(entries)
    })
  }

  delete(providerId: string): Promise<void> {
    return this.serialize(providerId, async () => {
      const entries = await this.load()
      if (entries[providerId] === undefined) return
      Reflect.deleteProperty(entries, providerId)
      await this.persist(entries)
    })
  }
}
