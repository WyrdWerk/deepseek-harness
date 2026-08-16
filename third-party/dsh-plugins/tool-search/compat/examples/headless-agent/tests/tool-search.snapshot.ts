/** Assembled-app proof for Native Tool Mode progressive disclosure. */

import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const configPath = fileURLToPath(new URL('../tool-search.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('../../../packages/examples/cli-demo/src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

interface JsonObject { [key: string]: unknown }

function records(content: string): JsonObject[] {
  return content.trimEnd().split('\n').map(line => JSON.parse(line) as JsonObject)
}

function jsonObject(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonObject
}

describe('tool-search headless snapshot', () => {
  it('loads one exact tool for the next request through the real Loader app', async () => {
    const result = await runLoaderSmoke({
      label: 'tool-search headless stream-json snapshot',
      tempDirPrefix: 'headless-snapshot-tool-search-',
      binScript,
      configPath,
      binArgs: [
        '--config',
        configPath,
        '--output-format',
        'stream-json',
        'Find the weather tool, use it, and report the result.',
      ],
      tsconfigPath,
    })

    expect(result.stderr).toBe('')
    const output = records(result.stdout)
    const events: JsonObject[] = []
    for (const record of output) {
      if (record.type === 'session_event') events.push(jsonObject(record.event, 'session event'))
    }
    const headers: unknown[][] = []
    const selections: unknown[] = []
    const calls: unknown[] = []
    for (const event of events) {
      if (event.type === 'request/header') {
        const data = jsonObject(event.data, 'request/header data')
        const header = jsonObject(data.header, 'request header')
        if (!Array.isArray(header.tools)) throw new Error('request header tools must be an array')
        headers.push(header.tools.map(tool => jsonObject(tool, 'tool schema').name))
      }
      if (event.type === 'tool-search/selection') selections.push(event.data)
      if (event.type === 'tool/call') calls.push(jsonObject(event.data, 'tool/call data').name)
    }
    const final = output.at(-1)

    expect({ headers, selections, calls, final: { type: final?.type, output: final?.output } })
      .toMatchInlineSnapshot(`
        {
          "calls": [
            "tool_search",
            "weather_lookup",
          ],
          "final": {
            "output": "Tool search loaded weather_lookup and it ran.",
            "type": "result",
          },
          "headers": [
            [
              "todo_write",
              "tool_search",
            ],
            [
              "todo_write",
              "tool_search",
              "weather_lookup",
            ],
          ],
          "selections": [
            {
              "query": "weather_lookup",
              "selected": [
                "weather_lookup",
              ],
            },
          ],
        }
      `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
