/**
 * File-backed credential store for OAuth-only pi-ai providers.
 *
 * Two on-disk shapes are read and written natively, so the harness shares a
 * credential file with the tools that already maintain it instead of forcing a
 * second login:
 *
 * - `pi` — the pi coding agent's `~/.pi/agent/auth.json`: one type-tagged
 *   credential object per provider key. pi's keys name the *login flow*, which
 *    is not always the pi-ai provider id — `xai` is stored under
 *   `xai-oauth` — so the store carries an explicit provider-id → file-key map.
 * - `codex-cli` — the Codex CLI's `~/.codex/auth.json`: a `tokens` object
 *   (`access_token`, `refresh_token`, `account_id`, optional `expires_at`).
 *
 * Writes are serialized per provider id (in-process promise chains) and land
 * atomically (tmp file + rename, mode 0600), because pi-ai's `Models` layer
 * runs OAuth refresh inside `modify` and relies on the store for mutual
 * exclusion. A `codex-cli` file without `expires_at` reports `expires: 0`,
 * which forces exactly one refresh before the first request and then records
 * the refreshed expiry in the file's own shape.
 *
 * @module dsh-llm-oauth/store
 */

import { readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Stored api-key credential (structural mirror of pi-ai's internal type). */
export interface StoredApiKeyCredential {
  type: 'api_key'
  key?: string
  env?: Record<string, string>
}

/** Stored OAuth credential; extra keys (e.g. `accountId`, `idToken`) ride along. */
export interface StoredOauthCredential {
  type: 'oauth'
  access: string
  refresh: string
  /** Expiry in epoch milliseconds; `0` means unknown (forces refresh). */
  expires: number
  [key: string]: unknown
}

/** One type-tagged credential per provider. */
export type StoredCredential = StoredApiKeyCredential | StoredOauthCredential

/** Non-secret credential metadata for listing. */
export interface StoredCredentialInfo {
  providerId: string
  type: StoredCredential['type']
}

/** The structural surface pi-ai's `createModels({ credentials })` consumes. */
export interface FileCredentialStore {
  readonly path: string
  read(providerId: string): Promise<StoredCredential | undefined>
  list(): Promise<readonly StoredCredentialInfo[]>
  modify(
    providerId: string,
    fn: (current: StoredCredential | undefined) => Promise<StoredCredential | undefined>,
  ): Promise<StoredCredential | undefined>
  delete(providerId: string): Promise<void>
}

/** The Codex CLI's `tokens` object, extra keys preserved on write. */
interface CodexCliTokens {
  access_token?: string
  refresh_token?: string
  account_id?: string
  expires_at?: number
  [key: string]: unknown
}

type Document = Record<string, unknown> & { tokens?: CodexCliTokens }

const DEFAULT_PI_STORE = join(homedir(), '.pi', 'agent', 'auth.json')
const DEFAULT_CODEX_STORE = join(homedir(), '.codex', 'auth.json')
const CODEX_PROVIDER_ID = 'openai-codex'

/** pi login-flow key for one pi-ai provider id; identity unless mapped. */
const PI_STORE_KEYS: Readonly<Record<string, string>> = {
  'openai-codex': 'openai-codex',
  'xai': 'xai-oauth',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isOauthCredential(value: unknown): value is StoredOauthCredential {
  return isRecord(value)
    && value.type === 'oauth'
    && typeof value.access === 'string'
    && typeof value.refresh === 'string'
}

function asCredential(value: unknown): StoredCredential | undefined {
  if (isOauthCredential(value)) return { ...value } as StoredOauthCredential
  if (isRecord(value) && value.type === 'api_key') return { ...value } as unknown as StoredApiKeyCredential
  return undefined
}

/** A JSON file holding credentials in one of the two supported shapes. */
export class JsonFileCredentialStore implements FileCredentialStore {
  readonly path: string
  private readonly chains = new Map<string, Promise<unknown>>()
  private readonly keyMap: ReadonlyMap<string, string>
  private format: 'pi' | 'codex-cli' | undefined

  constructor(path: string, keyMap: ReadonlyMap<string, string> = new Map()) {
    this.path = path
    this.keyMap = keyMap
  }

  /** The pi-format file key one pi-ai provider id is stored under. */
  private fileKeyOf(providerId: string): string {
    return this.keyMap.get(providerId) ?? providerId
  }

  /** The pi-ai provider id a pi-format file key belongs to (reverse map). */
  private providerIdOf(fileKey: string): string {
    for (const [providerId, mappedKey] of this.keyMap) {
      if (mappedKey === fileKey) return providerId
    }
    return fileKey
  }

  /** Load and parse the document, fixing its format on first sight. */
  private async load(): Promise<Document> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch {
      return {}
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error: unknown) {
      throw new Error(`credential store ${this.path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!isRecord(parsed)) return {}
    const doc = parsed as Document
    this.format ??= isRecord(doc.tokens) && typeof doc.tokens.access_token === 'string' ? 'codex-cli' : 'pi'
    return doc
  }

  /** Atomic durable write; 0600 so tokens never widen permissions. */
  private async persist(doc: Document): Promise<void> {
    const tmp = `${this.path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`
    await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 })
    await rename(tmp, this.path)
  }

  /** Serialize one provider's read-modify-write chain. */
  private serialize<T>(providerId: string, run: () => Promise<T>): Promise<T> {
    const prior = this.chains.get(providerId) ?? Promise.resolve()
    const next = prior.then(run, run)
    const settled = next.then(() => undefined, () => undefined)
    this.chains.set(providerId, settled)
    void settled.then(() => {
      if (this.chains.get(providerId) === settled) this.chains.delete(providerId)
    })
    return next
  }

  /** The stored credential for one provider, in the store's native format. */
  private credentialOf(doc: Document, providerId: string): StoredCredential | undefined {
    if (this.format === 'codex-cli') {
      if (providerId !== CODEX_PROVIDER_ID) return undefined
      const tokens = doc.tokens
      if (tokens === undefined || typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') {
        return undefined
      }
      return {
        type: 'oauth',
        access: tokens.access_token,
        refresh: tokens.refresh_token,
        expires: typeof tokens.expires_at === 'number' ? tokens.expires_at : 0,
        ...(tokens.account_id === undefined ? {} : { accountId: tokens.account_id }),
      }
    }
    return asCredential(doc[this.fileKeyOf(providerId)])
  }

  read(providerId: string): Promise<StoredCredential | undefined> {
    return this.serialize(providerId, async () => this.credentialOf(await this.load(), providerId))
  }

  list(): Promise<readonly StoredCredentialInfo[]> {
    return this.serialize('__list__', async () => {
      const doc = await this.load()
      if (this.format === 'codex-cli') {
        return doc.tokens !== undefined ? [{ providerId: CODEX_PROVIDER_ID, type: 'oauth' }] : []
      }
      return Object.keys(doc)
        .map(fileKey => [fileKey, asCredential(doc[fileKey])] as const)
        .filter((entry): entry is readonly [string, StoredCredential] => entry[1] !== undefined)
        .map(([fileKey, credential]) => ({ providerId: this.providerIdOf(fileKey), type: credential.type }))
    })
  }

  async modify(
    providerId: string,
    fn: (current: StoredCredential | undefined) => Promise<StoredCredential | undefined>,
  ): Promise<StoredCredential | undefined> {
    return this.serialize(providerId, async () => {
      const doc = await this.load()
      const current = this.credentialOf(doc, providerId)
      const next = await fn(current)
      const effective = next ?? current
      if (effective !== undefined) {
        if (!isOauthCredential(effective)) {
          throw new Error(`credential store ${this.path} accepts only oauth credentials, got type ${JSON.stringify((effective as StoredCredential).type)}`)
        }
        if (this.format === 'codex-cli') {
          if (providerId !== CODEX_PROVIDER_ID) {
            throw new Error(`credential store ${this.path} is a codex-cli file and only stores ${CODEX_PROVIDER_ID}`)
          }
          doc.tokens = {
            ...doc.tokens,
            access_token: effective.access,
            refresh_token: effective.refresh,
            ...(typeof effective.accountId === 'string' ? { account_id: effective.accountId } : {}),
            expires_at: effective.expires,
          }
        } else {
          doc[this.fileKeyOf(providerId)] = effective
        }
        await this.persist(doc)
      }
      return effective
    })
  }

  delete(providerId: string): Promise<void> {
    return this.serialize(providerId, async () => {
      const doc = await this.load()
      if (this.format === 'codex-cli') {
        if (providerId !== CODEX_PROVIDER_ID || doc.tokens === undefined) return
        delete doc.tokens
      } else {
        const fileKey = this.fileKeyOf(providerId)
        if (doc[fileKey] === undefined) return
        // no-dynamic-delete: the Reflect form is the sanctioned dynamic-key delete.
        Reflect.deleteProperty(doc, fileKey)
      }
      await this.persist(doc)
    })
  }
}

/** A resolved store plus where it came from. */
export interface ResolvedCredentialStore {
  store: JsonFileCredentialStore
  path: string
  /** Whether the chosen file existed; false means it is created on first write. */
  existed: boolean
}

/**
 * Pick the credential store: the explicit path when given, else the first
 * existing default. A machine with neither default gets the pi path, so a
 * future login or refresh creates it. The key map is applied to whichever
 * store is chosen.
 * @param explicit - configured path, or empty/undefined for auto-detection.
 * @param keyMap - pi-ai provider id → pi-format file key mapping.
 * @returns the store, its path, and whether the file already exists.
 */
export function resolveCredentialStore(
  explicit?: string,
  keyMap: ReadonlyMap<string, string> = new Map(Object.entries(PI_STORE_KEYS)),
): ResolvedCredentialStore {
  const trimmed = explicit?.trim()
  const candidates = trimmed !== undefined && trimmed.length > 0 ? [trimmed] : [DEFAULT_PI_STORE, DEFAULT_CODEX_STORE]
  for (const path of candidates) {
    if (existsSync(path)) return { store: new JsonFileCredentialStore(path, keyMap), path, existed: true }
  }
  const fallback = candidates[candidates.length - 1] ?? DEFAULT_PI_STORE
  return { store: new JsonFileCredentialStore(fallback, keyMap), path: fallback, existed: false }
}
