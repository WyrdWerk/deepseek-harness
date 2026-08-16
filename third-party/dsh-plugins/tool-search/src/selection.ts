/**
 * Durable tool-search selection validation shared by runtime recovery and the invariant companion.
 * @module @deepseek-ai/dsh-tool-search/selection
 */

/** Whole selected-name snapshot written after one successful search expansion. */
export interface ToolSearchSelection {
  /** Trimmed query that produced at least one newly selected tool. */
  readonly query: string
  /** Complete selected-name set in code-point order. */
  readonly selected: readonly string[]
}

/**
 * Stable code-point ordering for tool names.
 * @param left - first tool name.
 * @param right - second tool name.
 * @returns a negative, zero, or positive ordering value.
 */
export function compareToolNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Decode one durable whole selection and reject malformed or non-canonical data.
 * @param value - persisted event data crossing the session boundary.
 * @param label - subject named in a failure diagnostic.
 * @returns the validated immutable-compatible selection shape.
 */
export function decodeToolSearchSelection(value: unknown, label: string): ToolSearchSelection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort(compareToolNames)
  if (keys.length !== 2 || keys[0] !== 'query' || keys[1] !== 'selected') {
    throw new Error(`${label} must contain exactly query and selected`)
  }
  const query = record['query']
  if (typeof query !== 'string' || query.length === 0 || query.trim() !== query) {
    throw new Error(`${label}.query must be a non-empty trimmed string`)
  }
  const selected = record['selected']
  if (!Array.isArray(selected)) throw new Error(`${label}.selected must be an array`)
  let previous: string | undefined
  for (const name of selected) {
    if (typeof name !== 'string' || name.length === 0 || name.trim() !== name) {
      throw new Error(`${label}.selected entries must be non-empty trimmed strings`)
    }
    if (previous !== undefined && compareToolNames(previous, name) >= 0) {
      throw new Error(`${label}.selected must be unique and sorted`)
    }
    previous = name
  }
  return { query, selected }
}
