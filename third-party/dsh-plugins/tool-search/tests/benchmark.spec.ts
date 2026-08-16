import { describe, expect, it } from 'vitest'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { runToolSearchBenchmark } from './benchmark.ts'

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    input: { type: 'string', description: 'Task-specific input or identifier.' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
  required: ['input'],
}

const TARGETS: readonly ToolSchema[] = [
  { name: 'bash', description: 'Execute a shell command.', parameters: PARAMETERS },
  { name: 'read', description: 'Read file content.', parameters: PARAMETERS },
  { name: 'lsp', description: 'Find a language server definition.', parameters: PARAMETERS },
  { name: 'subagent', description: 'Delegate a task to a subagent.', parameters: PARAMETERS },
  { name: 'web_search', description: 'Search the web.', parameters: PARAMETERS },
]

const FIXTURE: readonly ToolSchema[] = [
  ...TARGETS,
  ...Array.from({ length: 35 }, (_, index): ToolSchema => ({
    name: `fixture_tool_${String(index + 1).padStart(2, '0')}`,
    description: `Deterministic first-party benchmark fixture ${index + 1}.`,
    parameters: PARAMETERS,
  })),
]

describe('tool-search progressive-disclosure benchmark', () => {
  it('keeps exact and representative capability recall while reducing schema pressure', async () => {
    const result = await runToolSearchBenchmark(FIXTURE)

    expect(result.sourceToolCount).toBeGreaterThanOrEqual(40)
    expect(result.rows.map(row => row.catalogSize)).toEqual([10, 30, 50, 100])
    for (const row of result.rows) {
      expect(row.initialSchemaTokens).toBeLessThan(row.selectedSchemaTokens)
      expect(row.selectedSchemaTokens).toBeLessThan(row.fullSchemaTokens)
      expect(row.initialSavingsPercent).toBeGreaterThan(80)
      expect(row.exactRecallAt1Percent).toBe(100)
      expect(row.semanticRecallAt5Percent).toBe(100)
      expect(row.extraModelTurns).toBe(1)
      expect(row.repeatedSelectionStable).toBe(true)
    }
  })
})
