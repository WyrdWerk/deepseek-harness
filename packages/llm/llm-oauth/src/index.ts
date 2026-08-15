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

import { createModels } from '@earendil-works/pi-ai'
import { builtinProviders } from '@earendil-works/pi-ai/providers/all'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { PiAiOAuthAdapter } from './adapter.ts'
import { resolveCredentialStore } from './store.ts'

export { PiAiOAuthAdapter } from './adapter.ts'
export type { PiAiOAuthAdapterOptions } from './adapter.ts'
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

  const models = createModels({ credentials: store })
  const catalog = builtinProviders()
  const disposers: Array<() => void> = []
  for (const [providerId, entryOf] of entries) {
    const provider = catalog.find(candidate => candidate.id === providerId)
    if (provider === undefined) {
      if (explicit) {
        throw new Error(`llm-oauth: the installed pi-ai catalog has no provider "${providerId}"`)
      }
      ctx.logger.warn(`llm-oauth: catalog provider "${providerId}" absent; skipping its default route`)
      continue
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
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
  })
}
