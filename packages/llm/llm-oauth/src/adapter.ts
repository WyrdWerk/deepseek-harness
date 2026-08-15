/**
 * OAuth-provider adapter over pi-ai's OAuth-only catalog providers.
 *
 * The pi-ai catalog provider owns the wire protocol and its OAuth method; this
 * class only bridges the Harness `GenerateOptions`/`StreamChunk` vocabulary,
 * reusing `dsh-llm-pi-ai`'s context conversion and stream translation so every
 * pi-ai-backed adapter stays wire-identical. Auth never touches this layer:
 * the `Models` collection was built with a credential store, and pi-ai
 * refreshes the stored OAuth token under the store lock before a request when
 * the access token is stale.
 *
 * @module dsh-llm-oauth/adapter
 */

import {
  attributionHeaders,
  contentHasImage,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { toPiContext, toStreamChunks } from '@deepseek-ai/dsh-llm-pi-ai'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import type { Api, Model, ModelThinkingLevel, Models, ThinkingLevel } from '@earendil-works/pi-ai'

/** Constructor options for {@link PiAiOAuthAdapter}. */
export interface PiAiOAuthAdapterOptions {
  /** The Harness provider route this adapter is registered under. */
  route: string
  /** Display name for selectors and status surfaces. */
  displayName: string
  /** The pi-ai provider id inside the `Models` collection. */
  providerId: string
  /** The collection that resolves OAuth auth and streams the catalog provider. */
  models: Models
  /** Context window assumed for a model id the installed catalog does not list. */
  fallbackContextWindow: number
  /** Output cap assumed for a model id the installed catalog does not list. */
  fallbackMaxTokens: number
  /** Idle-stream watchdog window, mirroring `llm-pi-ai`'s profile knob. */
  streamIdleTimeoutMs: number
  /** Provider base URL assumed for a model id the installed catalog does not list. */
  fallbackBaseUrl: string
  /** Resolve the durable attachment service when a request carries images. */
  resolveAttachments?: () => AttachmentStore | undefined
}

/** Zero cost for an unlisted model: absence of a fact, not a configured rate. */
const NO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const

/** One OAuth-only pi-ai catalog provider as a Harness LLM adapter. */
export class PiAiOAuthAdapter extends LlmAdapter {
  private readonly config: PiAiOAuthAdapterOptions

  constructor(config: PiAiOAuthAdapterOptions) {
    super()
    this.config = config
  }

  /** The catalog's first model, whose shape an unlisted id assumes. */
  private firstCatalogModel(): Model<Api> | undefined {
    return this.config.models.getModels(this.config.providerId)[0]
  }

  /** The wire api to assume for a model id the catalog does not list. */
  private fallbackApi(): Model<Api>['api'] {
    return this.firstCatalogModel()?.api ?? 'openai-completions'
  }

  /** The endpoint to assume for a model id the catalog does not list. */
  private fallbackBaseUrl(): string {
    return this.firstCatalogModel()?.baseUrl ?? this.config.fallbackBaseUrl
  }

  /** The catalog model, or a conservative text-only stand-in for a new id. */
  private modelOf(modelId: string): Model<Api> {
    const listed = this.config.models.getModels(this.config.providerId)
      .find(candidate => candidate.id === modelId)
    if (listed !== undefined) return listed
    return {
      id: modelId,
      name: modelId,
      provider: this.config.providerId,
      api: this.fallbackApi(),
      baseUrl: this.fallbackBaseUrl(),
      reasoning: false,
      input: ['text'],
      cost: NO_COST,
      contextWindow: this.config.fallbackContextWindow,
      maxTokens: this.config.fallbackMaxTokens,
    } satisfies Model<Api>
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.config.displayName }
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.config.models.getModels(this.config.providerId)
      .map(model => ({
        provider,
        id: model.id,
        name: model.name,
        inputModalities: [...model.input],
      })))
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve().then(() => {
      const resolvedModel = this.modelOf(model)
      const efforts = getSupportedThinkingLevels(resolvedModel)
        .map(level => ({ id: ReasoningEffortId(level), name: level }))
      return {
        provider,
        id: model,
        name: resolvedModel.name,
        inputModalities: [...resolvedModel.input],
        context: { contextWindow: resolvedModel.contextWindow },
        ...(efforts.length > 0 ? { reasoning: { efforts } } : {}),
      }
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.stop !== undefined) {
      throw new LlmError('llm-oauth does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
    }
    const model = this.modelOf(options.model)
    const supported = getSupportedThinkingLevels(model)
    const requested = options.reasoningEffort === undefined || options.reasoningEffort === 'off'
      ? undefined
      : options.reasoningEffort as ModelThinkingLevel
    if (requested !== undefined && !supported.some(level => level === requested)) {
      throw new LlmError(
        `provider "${this.config.providerId}" model "${model.id}" does not support reasoning effort "${requested}"`,
        'UNSUPPORTED_OPTION',
      )
    }
    const enabledReasoning: ThinkingLevel | undefined = requested === undefined || requested === 'off'
      ? undefined
      : requested

    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    using watchdog = idleWatchdog(upstream, this.config.streamIdleTimeoutMs, 'LLM_STREAM_IDLE_TIMEOUT')

    try {
      const containsImage = options.messages.some(message => contentHasImage(message.content))
      if (containsImage && !model.input.includes('image')) {
        throw new LlmError(`provider "${this.config.providerId}" model "${model.id}" does not support image input`, 'UNSUPPORTED_CONTENT')
      }
      const attachments = containsImage ? this.config.resolveAttachments?.() : undefined
      if (containsImage && attachments === undefined) {
        throw new LlmError('image input requires the durable attachment service', 'UNSUPPORTED_CONTENT')
      }
      const context = attachments === undefined
        ? toPiContext(options)
        : await toPiContext(options, attachments)
      const events = this.config.models.streamSimple(model, context, {
        ...enabledReasoning === undefined ? {} : { reasoning: enabledReasoning },
        ...options.temperature === undefined ? {} : { temperature: options.temperature },
        ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
        ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
        signal: watchdog.signal,
        // Attribution names are Harness-owned; these routes carry no extra headers.
        headers: attributionHeaders(),
        // The agent recovery layer owns visible attempts.
        maxRetries: 0,
      })
      const iterator = toStreamChunks(events, model.contextWindow)[Symbol.asyncIterator]()
      let exhausted = false
      try {
        while (true) {
          const result = await watchdog.next(iterator)
          const timeout = timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT')
          if (timeout !== undefined) throw timeout
          if (result.done) {
            exhausted = true
            return
          }
          yield result.value
        }
      } finally {
        if (!exhausted) {
          consumer.abort('oauth stream consumer stopped')
          try {
            await iterator.return(undefined)
          } catch (_abortedSdkTeardown) {
            // The stable signal already owns SDK termination.
          }
        }
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT') !== undefined) {
        throw new LlmError(`stream idle timeout after ${this.config.streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted) {
        throw new LlmError('request aborted by caller', 'ABORTED', { cause: error })
      }
      throw error
    } finally {
      consumer.abort('oauth stream consumer stopped')
    }
  }
}
