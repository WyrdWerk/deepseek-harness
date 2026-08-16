/** Keyless model adapter and target tool for the tool-search assembled snapshot. @module tool-search-driver */

import type { Context } from 'cordis'
import {
  CallId,
  LlmAdapter,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

function assertTools(options: GenerateOptions, expected: readonly string[]): void {
  const actual = (options.tools ?? []).map(tool => tool.name).sort()
  if (actual.join('\0') !== [...expected].sort().join('\0')) {
    throw new Error(`tool-search snapshot expected [${expected.join(', ')}], got [${actual.join(', ')}]`)
  }
}

class ToolSearchSnapshotAdapter extends LlmAdapter {
  private index = 0

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.index += 1
    if (this.index === 1) {
      assertTools(options, ['todo_write', 'tool_search'])
      const args = JSON.stringify({ query: 'weather_lookup', limit: 1 })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: CallId('call_find_weather'), name: 'tool_search', arguments: args },
      }
      yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 4 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (this.index === 2) {
      assertTools(options, ['todo_write', 'tool_search', 'weather_lookup'])
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: CallId('call_weather'), name: 'weather_lookup', arguments: '{}' },
      }
      yield { type: 'usage', usage: { inputTokens: 13, outputTokens: 3 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (this.index !== 3) throw new Error('tool-search snapshot script exhausted')
    assertTools(options, ['todo_write', 'tool_search', 'weather_lookup'])
    const text = 'Tool search loaded weather_lookup and it ran.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 9, outputTokens: 3 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Services required before the fixture registers its route and target tool. */
export const inject = ['llm', 'tools']

/** Register the deterministic adapter and one deferred global tool. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['tool-search-mock'], new ToolSearchSnapshotAdapter())
  ctx.tools.register(defineTool({
    name: 'weather_lookup',
    description: 'Look up current weather for the requested place.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        condition: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: `Weather: ${value.condition}.` }],
    },
    execute: () => Promise.resolve({ condition: 'clear' }),
  }))
}
