/**
 * OAuth-only provider routes for the Harness LLM seam.
 *
 * `dsh-llm-pi-ai` deliberately cannot serve pi-ai's OAuth-only providers: it
 * resolves credentials through the api-key seam and holds no OAuth store. This
 * plugin fills that gap for the OAuth providers the installed pi-ai catalog
 * ships — `openai-codex` (ChatGPT subscription) and `xai` (Grok/X
 * subscription) — by mounting each catalog provider on one `Models`
 * collection built with a file-backed credential store, and registering one
 * adapter per configured route. Token refresh runs inside pi-ai under the
 * store lock whenever an access token goes stale.
 *
 * Model lists stay current: each provider is rebuilt with a `fetchModels`
 * overlay that lists its own endpoint (ChatGPT Codex `/codex/models`, xAI
 * `/v1/models`) over the freshly refreshed OAuth credential, caches the
 * result on disk, and re-fetches on mount and on an interval — so new model
 * releases appear without a plugin upgrade, exactly like pi and oh-my-pi.
 *
 * ```yaml
 * - id: llm-oauth
 *   name: '@deepseek-ai/dsh-llm-oauth'
 *   config:
 *     providers:
 *       openai-codex:
 *         route: codex
 *       xai:
 *         route: xai
 *     # authPath: /home/me/.pi/agent/auth.json
 * ```
 *
 * An empty `providers` map mounts both defaults above. Credentials come from
 * the first existing store of `~/.pi/agent/auth.json` (pi) then
 * `~/.codex/auth.json` (Codex CLI); `authPath` pins one explicitly. In pi's
 * file, `xai` is stored under its login-flow key `xai-oauth` — the mapping is
 * built in.
 *
 * @module @deepseek-ai/dsh-llm-oauth
 */

import { createModels, createProvider } from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import { openAICodexResponsesApi } from '@earendil-works/pi-ai/api/openai-codex-responses.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { PiAiOAuthAdapter } from './adapter.ts'
import { fetchCodexModels, fetchXaiModels, JsonFileModelsStore } from './catalog.ts'
import { resolveCredentialStore } from './store.ts'

export { PiAiOAuthAdapter } from './adapter.ts'
export type { PiAiOAuthAdapterOptions } from './adapter.ts'
export { fetchCodexModels, fetchXaiModels, JsonFileModelsStore } from './catalog.ts'
export { JsonFileCredentialStore, resolveCredentialStore } from './store.ts'
export type {
  FileCredentialStore,
  ResolvedCredentialStore,
  StoredApiKeyCredential,
  StoredCredential,
  StoredCredentialInfo,
  StoredOauthCredential,
} from './store.ts'

/** One configured OAuth provider entry; empty values resolve to the defaults. */
export interface OAuthProviderEntry {
  /** Harness provider route to register. */
  route: string
  /** Display name for the route. */
  displayName: string
  /** pi-format credential file key; defaults to the provider's login-flow key. */
  storeKey: string
  /** Context window assumed for a model id the installed catalog does not list. */
  fallbackContextWindow: number
  /** Output cap assumed for a model id the installed catalog does not list. */
  fallbackMaxTokens: number
}

/** Plugin configuration. */
export interface Config {
  /** Explicit credential-store path; empty auto-detects pi then Codex CLI. */
  authPath: string
  /** Idle-stream watchdog window in milliseconds. */
  streamIdleTimeoutMs: number
  /**
   * OAuth providers to mount, keyed by pi-ai provider id. Empty mounts the
   * built-in defaults (`openai-codex` and `xai`).
   */
  providers: Record<string, OAuthProviderEntry>
  /** Fetch model lists from each provider's listing endpoint and keep them fresh. */
  dynamicModels: boolean
  /** Codex CLI version to claim when listing ChatGPT Codex models. */
  clientVersion: string
  /** Model-cache file; empty uses ~/.cache/dsh/llm-oauth-models.json. */
  modelsCachePath: string
  /** Milliseconds between background catalog refreshes. */
  refreshIntervalMs: number
}

const entry: z<OAuthProviderEntry> = z.object({
  route: z.string().default(''),
  displayName: z.string().default(''),
  storeKey: z.string().default(''),
  fallbackContextWindow: z.number().step(1).min(0).default(0),
  fallbackMaxTokens: z.number().step(1).min(0).default(0),
})

export const Config: z<Config> = z.object({
  authPath: z.string().default(''),
  streamIdleTimeoutMs: z.number().min(1_000).max(2 ** 31 - 1).default(300_000),
  providers: z.dict(entry).default({}),
  dynamicModels: z.boolean().default(true),
  clientVersion: z.string().default('0.147.0'),
  modelsCachePath: z.string().default(''),
  refreshIntervalMs: z.number().min(60_000).max(2 ** 31 - 1).default(6 * 60 * 60 * 1000),
})

/** Shipped defaults for the OAuth providers the installed catalog carries. */
interface ProviderDefaults extends OAuthProviderEntry {}
const DEFAULT_PROVIDERS: Readonly<Record<string, ProviderDefaults>> = {
  'openai-codex': {
    route: 'codex',
    displayName: 'Codex (ChatGPT OAuth)',
    storeKey: 'openai-codex',
    fallbackContextWindow: 272_000,
    fallbackMaxTokens: 65_536,
  },
  'xai': {
    route: 'xai',
    displayName: 'xAI (Grok OAuth)',
    storeKey: 'xai-oauth',
    fallbackContextWindow: 256_000,
    fallbackMaxTokens: 32_768,
  },
}

/** Generic defaults for a provider entry with no shipped default. */
function genericDefaults(providerId: string): ProviderDefaults {
  return {
    route: providerId,
    displayName: providerId,
    storeKey: providerId,
    fallbackContextWindow: 131_072,
    fallbackMaxTokens: 32_768,
  }
}

/** Resolve one entry over its defaults. */
function resolveEntry(providerId: string, raw: OAuthProviderEntry): OAuthProviderEntry {
  const base = DEFAULT_PROVIDERS[providerId] ?? genericDefaults(providerId)
  return {
    route: raw.route.trim().length > 0 ? raw.route.trim() : base.route,
    displayName: raw.displayName.trim().length > 0 ? raw.displayName.trim() : base.displayName,
    storeKey: raw.storeKey.trim().length > 0 ? raw.storeKey.trim() : base.storeKey,
    fallbackContextWindow: raw.fallbackContextWindow > 0 ? raw.fallbackContextWindow : base.fallbackContextWindow,
    fallbackMaxTokens: raw.fallbackMaxTokens > 0 ? raw.fallbackMaxTokens : base.fallbackMaxTokens,
  }
}

export const name = 'llm-oauth'
export const inject = ['llm']

export function apply(ctx: Context, config: Config): void {
  const requested = Object.keys(config.providers)
  const providerIds = requested.length > 0 ? requested : Object.keys(DEFAULT_PROVIDERS)
  const explicit = requested.length > 0
  const entries = new Map(providerIds.map((providerId) => {
    const raw = config.providers[providerId] ?? {} as OAuthProviderEntry
    return [providerId, resolveEntry(providerId, raw)]
  }))

  // Duplicate routes would collide at the registry; fail here naming both.
  const byRoute = new Map<string, string>()
  for (const [providerId, entryOf] of entries) {
    const clash = byRoute.get(entryOf.route)
    if (clash !== undefined) {
      throw new Error(`llm-oauth: providers "${clash}" and "${providerId}" both claim route "${entryOf.route}"`)
    }
    byRoute.set(entryOf.route, providerId)
  }

  const keyMap = new Map([...entries].map(([providerId, entryOf]) => [providerId, entryOf.storeKey]))
  const { store, path, existed } = resolveCredentialStore(
    config.authPath.trim().length > 0 ? config.authPath.trim() : undefined,
    keyMap,
  )
  if (!existed) {
    ctx.logger.warn(
      `llm-oauth: no credential file at ${path} yet; log in once with pi or the Codex CLI, or set authPath`,
    )
  }

  const modelsCachePath = config.modelsCachePath.trim().length > 0
    ? config.modelsCachePath.trim()
    : join(homedir(), '.cache', 'dsh', 'llm-oauth-models.json')
  const models = createModels({
    credentials: store,
    ...config.dynamicModels ? { modelsStore: new JsonFileModelsStore(modelsCachePath) } : {},
  })
  const catalog = builtinProviders()
  const disposers: Array<() => void> = []
  for (const [providerId, entryOf] of entries) {
    let provider = catalog.find(candidate => candidate.id === providerId)
    if (provider === undefined) {
      if (explicit) {
        throw new Error(`llm-oauth: the installed pi-ai catalog has no provider "${providerId}"`)
      }
      ctx.logger.warn(`llm-oauth: catalog provider "${providerId}" absent; skipping its default route`)
      continue
    }
    if (config.dynamicModels && (providerId === 'openai-codex' || providerId === 'xai')) {
      // Rebuild the catalog provider with a fetchModels overlay: same id, auth,
      // and wire implementations, plus the listing fetcher whose result
      // Models.refreshModels() caches on disk and serves as the live catalog.
      // The static catalog stays as the baseline until the first fetch lands.
      provider = createProvider({
        id: provider.id,
        name: provider.name,
        ...provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl },
        ...provider.headers === undefined ? {} : { headers: provider.headers },
        auth: provider.auth,
        models: [...provider.getModels()],
        api: providerId === 'openai-codex'
          ? openAICodexResponsesApi()
          : {
            'openai-completions': openAICompletionsApi(),
            'openai-responses': openAIResponsesApi(),
          },
        fetchModels: providerId === 'openai-codex'
          ? context => fetchCodexModels(context, config.clientVersion)
          : fetchXaiModels,
      })
    }
    models.setProvider(provider)
    const adapter = new PiAiOAuthAdapter({
      route: entryOf.route,
      displayName: entryOf.displayName,
      providerId,
      models,
      fallbackContextWindow: entryOf.fallbackContextWindow,
      fallbackMaxTokens: entryOf.fallbackMaxTokens,
      streamIdleTimeoutMs: config.streamIdleTimeoutMs,
      fallbackBaseUrl: provider.baseUrl ?? `https://${providerId}.example/v1`,
      resolveAttachments: () => ctx.get('attachments'),
    })
    disposers.push(ctx.llm.registerAdapter([entryOf.route], adapter))
  }

  if (config.dynamicModels) {
    // `Models.refreshModels()` exists on the runtime class but not the
    // exported interface, so reach it structurally and guard the call.
    interface RefreshOutcome {
      aborted: boolean
      errors: ReadonlyMap<string, Error>
    }
    interface RefreshCall {
      refresh?: (options?: {
        allowNetwork?: boolean
        force?: boolean
        signal?: AbortSignal
      }) => Promise<RefreshOutcome>
    }
    const refresher = models as unknown as RefreshCall
    const refresh = (): Promise<void> => {
      if (refresher.refresh === undefined) {
        ctx.logger.warn('llm-oauth: installed pi-ai exposes no Models.refresh; model lists stay static')
        return Promise.resolve()
      }
      return refresher.refresh({ allowNetwork: true })
        .then((result: { aborted: boolean; errors: ReadonlyMap<string, Error> }) => {
          for (const [id, error] of result.errors) {
            ctx.logger.warn(`llm-oauth: model refresh for "${id}" failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        })
        .catch((error: unknown) => ctx.logger.warn(`llm-oauth: model refresh failed: ${error instanceof Error ? error.message : String(error)}`))
    }
    // Mount-time refresh restores the disk cache instantly and fetches when
    // stale; the interval keeps the list current for new model releases.
    void refresh()
    const timer = setInterval(() => void refresh(), config.refreshIntervalMs)
    ctx.effect(() => () => clearInterval(timer))
  }

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}
