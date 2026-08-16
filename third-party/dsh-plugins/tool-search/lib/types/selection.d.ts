/**
 * Durable tool-search selection validation shared by runtime recovery and the invariant companion.
 * @module @deepseek-ai/dsh-tool-search/selection
 */
/** Whole selected-name snapshot written after one successful search expansion. */
export interface ToolSearchSelection {
    /** Trimmed query that produced at least one newly selected tool. */
    readonly query: string;
    /** Complete selected-name set in code-point order. */
    readonly selected: readonly string[];
}
/**
 * Stable code-point ordering for tool names.
 * @param left - first tool name.
 * @param right - second tool name.
 * @returns a negative, zero, or positive ordering value.
 */
export declare function compareToolNames(left: string, right: string): number;
/**
 * Decode one durable whole selection and reject malformed or non-canonical data.
 * @param value - persisted event data crossing the session boundary.
 * @param label - subject named in a failure diagnostic.
 * @returns the validated immutable-compatible selection shape.
 */
export declare function decodeToolSearchSelection(value: unknown, label: string): ToolSearchSelection;
