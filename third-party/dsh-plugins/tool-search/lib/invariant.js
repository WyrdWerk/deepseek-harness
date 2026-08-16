//#region lib/types/selection.js
/**
* Durable tool-search selection validation shared by runtime recovery and the invariant companion.
* @module @deepseek-ai/dsh-tool-search/selection
*/
/**
* Stable code-point ordering for tool names.
* @param left - first tool name.
* @param right - second tool name.
* @returns a negative, zero, or positive ordering value.
*/
function compareToolNames(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
/**
* Decode one durable whole selection and reject malformed or non-canonical data.
* @param value - persisted event data crossing the session boundary.
* @param label - subject named in a failure diagnostic.
* @returns the validated immutable-compatible selection shape.
*/
function decodeToolSearchSelection(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
	const record = value;
	const keys = Object.keys(record).sort(compareToolNames);
	if (keys.length !== 2 || keys[0] !== "query" || keys[1] !== "selected") throw new Error(`${label} must contain exactly query and selected`);
	const query = record["query"];
	if (typeof query !== "string" || query.length === 0 || query.trim() !== query) throw new Error(`${label}.query must be a non-empty trimmed string`);
	const selected = record["selected"];
	if (!Array.isArray(selected)) throw new Error(`${label}.selected must be an array`);
	let previous;
	for (const name of selected) {
		if (typeof name !== "string" || name.length === 0 || name.trim() !== name) throw new Error(`${label}.selected entries must be non-empty trimmed strings`);
		if (previous !== void 0 && compareToolNames(previous, name) >= 0) throw new Error(`${label}.selected must be unique and sorted`);
		previous = name;
	}
	return {
		query,
		selected
	};
}
//#endregion
//#region lib/types/invariant.js
/** Package-owned durable selection invariants. @module @deepseek-ai/dsh-tool-search/invariant */
const PACKAGE_NAME = "@deepseek-ai/dsh-tool-search";
/** Cordis companion plugin name. */
const name = "tool-search-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/** Validate one session's selection snapshots as strict cumulative supersets. */
function validateEvents(events, fail) {
	let selected = /* @__PURE__ */ new Set();
	for (const event of events) {
		if (event.type !== "tool-search/selection") continue;
		let snapshot;
		try {
			snapshot = decodeToolSearchSelection(event.data, "tool-search/selection");
		} catch (error) {
			fail(error.message);
		}
		const next = new Set(snapshot.selected);
		for (const toolName of selected) if (!next.has(toolName)) fail(`tool-search/selection dropped selected tool ${JSON.stringify(toolName)}`);
		if (next.size === selected.size) fail("tool-search/selection must add at least one tool");
		selected = next;
	}
}
/** Install validation for loaded sessions and each newly appended selection. */
const install = Object.assign((ctx, fail) => {
	const prefixes = /* @__PURE__ */ new WeakMap();
	for (const session of ctx.sessions.list()) {
		const events = [...session.events];
		validateEvents(events, fail);
		prefixes.set(session, events);
	}
	ctx.on("internal/dispatch", (_mode, eventName, args) => {
		if (eventName !== "session/event") return;
		const [session, event] = args;
		if (event.type !== "tool-search/selection") return;
		const events = [...prefixes.get(session) ?? session.events.slice(0, event.seq), event];
		validateEvents(events, fail);
		prefixes.set(session, events);
	}, { global: true });
}, { inject: ["sessions"] });
/**
* Register this package's invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
