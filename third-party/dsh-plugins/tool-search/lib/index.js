import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
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
//#region lib/types/index.js
/**
* Experimental Native Tool Mode progressive disclosure: each agent keeps a
* small global tool surface plus a scope-local `tool_search` discovery tool.
* Search selections are durable whole snapshots and widen only this plugin's
* restriction, so an independent parent/tool-filter restriction still wins.
* @module @deepseek-ai/dsh-tool-search
*/
/** Cordis plugin name. */
const name = "tool-search";
/** Services required to attach one search surface to every live agent. */
const inject = ["agents", "tools"];
/** Model-facing discovery tool name. */
const TOOL_SEARCH_NAME = "tool_search";
/** Schemastery validation and defaults for {@link Config}. */
const Config = z.object({
	alwaysVisible: z.array(z.string()).default([]),
	maxResults: z.number().default(5),
	maxQueryChars: z.number().default(512)
});
const RESULT_STATUSES = [
	"loaded",
	"already_loaded",
	"unavailable"
];
/** Normalize user/catalog text for deterministic lexical comparison. */
function normalizeText(value) {
	return value.normalize("NFKC").toLowerCase();
}
/** Tokenize Unicode letters and numbers; punctuation and identifier separators form boundaries. */
function tokenize(value) {
	return normalizeText(value).match(/[\p{L}\p{N}]+/gu) ?? [];
}
/** Build a term-frequency map without retaining duplicate token strings. */
function frequencies(tokens) {
	const result = /* @__PURE__ */ new Map();
	for (const token of tokens) result.set(token, (result.get(token) ?? 0) + 1);
	return result;
}
/** Convert a detached model-facing schema to its searchable representation. */
function catalogEntry(schema) {
	const normalizedName = normalizeText(schema.name);
	const normalizedDescription = normalizeText(schema.description);
	const tokens = [...tokenize(schema.name), ...tokenize(schema.description)];
	return {
		schema,
		normalizedName,
		normalizedDescription,
		tokens,
		frequencies: frequencies(tokens)
	};
}
/** BM25 contribution for one query term and one catalog entry. */
function bm25(termFrequency, documentFrequency, documentLength, averageDocumentLength, documentCount) {
	const k1 = 1.2;
	const b = .75;
	const inverseDocumentFrequency = Math.log(1 + (documentCount - documentFrequency + .5) / (documentFrequency + .5));
	const normalizedLength = documentLength / averageDocumentLength;
	return inverseDocumentFrequency * (termFrequency * 2.2 / (termFrequency + k1 * (.25 + b * normalizedLength)));
}
/** Rank name/description matches, forcing exact callable-name terms ahead of BM25-only matches. */
function rankCatalog(query, entries) {
	if (entries.length === 0) return [];
	const normalizedQuery = normalizeText(query);
	const queryTokens = [...new Set(tokenize(query))];
	const rawTerms = new Set(normalizedQuery.split(/\s+/u).filter(Boolean));
	const documentFrequency = /* @__PURE__ */ new Map();
	for (const term of queryTokens) documentFrequency.set(term, entries.filter((entry) => entry.frequencies.has(term)).length);
	const averageDocumentLength = Math.max(1, entries.reduce((total, entry) => total + entry.tokens.length, 0) / entries.length);
	const ranked = [];
	for (const entry of entries) {
		let score = 0;
		if (entry.normalizedName === normalizedQuery) score += 1e6;
		if (rawTerms.has(entry.normalizedName)) score += 1e5;
		if (normalizedQuery.length > 0 && entry.normalizedName.includes(normalizedQuery)) score += 1e3;
		if (normalizedQuery.length > 0 && entry.normalizedDescription.includes(normalizedQuery)) score += 100;
		const nameTokens = new Set(tokenize(entry.schema.name));
		for (const term of queryTokens) {
			const termFrequency = entry.frequencies.get(term) ?? 0;
			if (termFrequency > 0) score += bm25(termFrequency, documentFrequency.get(term), entry.tokens.length, averageDocumentLength, entries.length);
			if (nameTokens.has(term)) score += 50;
			if (entry.normalizedName.startsWith(term)) score += 20;
		}
		if (score > 0) ranked.push({
			entry,
			score
		});
	}
	return ranked.sort((left, right) => right.score - left.score || compareToolNames(left.entry.schema.name, right.entry.schema.name));
}
/** Compile a `*` wildcard while treating every other regexp character literally. */
function wildcard(pattern) {
	const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`);
	return new RegExp(`^${escaped.replaceAll("*", ".*")}$`);
}
/** Resolve one positive safe-integer config field. */
function positiveInteger(field, value, fallback) {
	const resolved = value ?? fallback;
	if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`tool-search: ${field} must be a positive safe integer, got ${String(resolved)}`);
	return resolved;
}
/** Resolve and validate configuration once at plugin load. */
function resolveConfig(config) {
	const patterns = config.alwaysVisible ?? [];
	const seen = /* @__PURE__ */ new Set();
	return {
		alwaysVisible: patterns.map((pattern) => {
			if (pattern.length === 0 || pattern.trim() !== pattern) throw new Error("tool-search: alwaysVisible entries must be non-empty and have no surrounding whitespace");
			if (seen.has(pattern)) throw new Error(`tool-search: alwaysVisible repeats pattern ${JSON.stringify(pattern)}`);
			seen.add(pattern);
			return wildcard(pattern);
		}),
		maxResults: positiveInteger("maxResults", config.maxResults, 5),
		maxQueryChars: positiveInteger("maxQueryChars", config.maxQueryChars, 512)
	};
}
/** Latest durable whole selection, or an empty set before the first search expansion. */
function restoreSelection(agent) {
	for (const event of [...agent.session.events].reverse()) {
		if (event.type !== "tool-search/selection") continue;
		const snapshot = decodeToolSearchSelection(event.data, "tool-search/selection");
		return new Set(snapshot.selected);
	}
	return /* @__PURE__ */ new Set();
}
/** Render a compact result; full schemas arrive through the next request header. */
function renderResult(value) {
	if (value.tools.length === 0) return "No matching tools found.";
	return `Tool search results:\n${value.tools.map((tool) => `- ${tool.name}: ${tool.status}`).join("\n")}\nRemaining deferred tools: ${value.remainingDeferred}.`;
}
/**
* Install progressive disclosure for every current and future agent.
* @param ctx - plugin context carrying agent and tool registries.
* @param config - visibility patterns and per-call bounds.
*/
function apply(ctx, config) {
	const resolved = resolveConfig(config);
	const states = /* @__PURE__ */ new Map();
	let registryMutationDepth = 0;
	/** Run a registry mutation without treating its own `tools/change` as an external update. */
	function mutateRegistry(operation) {
		registryMutationDepth += 1;
		try {
			return operation();
		} finally {
			registryMutationDepth -= 1;
		}
	}
	/** Current global schemas keyed by callable name. */
	function globalSchemas() {
		return new Map(ctx.tools.schemas().map((schema) => [schema.name, schema]));
	}
	/** Refresh the safe searchable catalog without exposing names hidden at agent creation. */
	function refreshCatalog(state) {
		const globals = globalSchemas();
		if (state.admitFutureGlobalTools) for (const toolName of globals.keys()) state.eligibleNames.add(toolName);
		state.catalog = new Map([...globals].filter(([toolName]) => state.eligibleNames.has(toolName)).map(([toolName, schema]) => [toolName, catalogEntry(schema)]));
	}
	/** Names this plugin allows; independent restrictions still intersect afterward. */
	function desiredAllowedNames(state) {
		return [...new Set(globalSchemas().keys())].filter((toolName) => state.selectedNames.has(toolName) || resolved.alwaysVisible.some((pattern) => pattern.test(toolName))).sort(compareToolNames);
	}
	/** Replace only this plugin's restriction, installing before lifting to avoid an open interval. */
	function refreshRestriction(state) {
		const nextNames = desiredAllowedNames(state);
		if (state.liftRestriction !== void 0 && nextNames.length === state.allowedNames.length && nextNames.every((toolName, index) => toolName === state.allowedNames[index])) return;
		const liftNext = mutateRegistry(() => state.agent.ctx.tools.restrict({ allow: nextNames }));
		const liftPrevious = state.liftRestriction;
		state.liftRestriction = liftNext;
		state.allowedNames = nextNames;
		if (liftPrevious !== void 0) mutateRegistry(liftPrevious);
	}
	/** Search and commit a cumulative selection for one agent. */
	function search(state, rawQuery, requestedLimit, caller, parent) {
		if (caller !== state.agent) throw new Error("tool_search requires its owning live agent");
		if (parent !== void 0) throw new Error("tool_search supports Native Tool Mode only in this experimental version");
		const query = rawQuery.trim();
		if (query.length === 0) throw new Error("tool_search query must not be blank");
		if (query.length > resolved.maxQueryChars) throw new Error(`tool_search query exceeds maxQueryChars (${resolved.maxQueryChars})`);
		const limit = requestedLimit ?? resolved.maxResults;
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > resolved.maxResults) throw new Error(`tool_search limit must be an integer from 1 to ${resolved.maxResults}`);
		refreshCatalog(state);
		const matches = rankCatalog(query, [...state.catalog.values()]).slice(0, limit);
		const visibleBefore = new Set(ctx.tools.schemas(state.agent).map((schema) => schema.name));
		const previousSelection = new Set(state.selectedNames);
		for (const { entry } of matches) state.selectedNames.add(entry.schema.name);
		if (state.selectedNames.size !== previousSelection.size) try {
			refreshRestriction(state);
			state.agent.session.append("tool-search/selection", {
				query,
				selected: [...state.selectedNames].sort(compareToolNames)
			});
		} catch (error) {
			state.selectedNames.clear();
			for (const toolName of previousSelection) state.selectedNames.add(toolName);
			refreshRestriction(state);
			throw error;
		}
		const visibleAfter = new Set(ctx.tools.schemas(state.agent).map((schema) => schema.name));
		return {
			query,
			tools: matches.map(({ entry }) => ({
				name: entry.schema.name,
				status: !visibleAfter.has(entry.schema.name) ? "unavailable" : visibleBefore.has(entry.schema.name) ? "already_loaded" : "loaded"
			})),
			remainingDeferred: [...state.catalog.keys()].filter((toolName) => !visibleAfter.has(toolName)).length
		};
	}
	/** Attach search and the initial restriction to one exact live agent. */
	function install(agent) {
		if (states.has(agent)) return;
		const globals = globalSchemas();
		const eligibleNames = /* @__PURE__ */ new Set();
		let everyGlobalVisible = true;
		for (const toolName of globals.keys()) if (ctx.tools.get(toolName, agent) === ctx.tools.get(toolName)) eligibleNames.add(toolName);
		else everyGlobalVisible = false;
		const state = {
			agent,
			admitFutureGlobalTools: everyGlobalVisible,
			eligibleNames,
			selectedNames: restoreSelection(agent),
			catalog: /* @__PURE__ */ new Map(),
			allowedNames: [],
			liftRestriction: void 0,
			removeSearchTool: void 0
		};
		states.set(agent, state);
		try {
			refreshCatalog(state);
			state.removeSearchTool = mutateRegistry(() => agent.ctx.tools.register(defineTool({
				name: TOOL_SEARCH_NAME,
				description: "Search tools that are not currently visible. Describe the capability you need or name a tool exactly. Matching tools are loaded for the next model request; call them only after this result returns.",
				parameters: {
					query: {
						type: "string",
						required: true,
						description: `Capability or exact tool name to find (maximum ${resolved.maxQueryChars} characters).`
					},
					limit: {
						type: "integer",
						description: `Maximum matches to load, from 1 to ${resolved.maxResults}.`
					}
				},
				output: {
					schema: {
						type: "object",
						additionalProperties: false,
						properties: {
							query: {
								type: "string",
								required: true
							},
							tools: {
								type: "array",
								required: true,
								items: {
									type: "object",
									additionalProperties: false,
									properties: {
										name: {
											type: "string",
											required: true
										},
										status: {
											type: "string",
											required: true,
											enum: [...RESULT_STATUSES]
										}
									}
								}
							},
							remainingDeferred: {
								type: "integer",
								required: true
							}
						}
					},
					render: (_args, value) => [{
						type: "text",
						text: renderResult(value)
					}]
				},
				presentCall: (args) => ({
					card: "generic",
					title: "Search tools",
					kind: "search",
					rawInput: args.query
				}),
				presentResult: (_args, result) => ({
					card: "generic",
					title: result.isError ? "Tool search failed" : "Tool search results",
					content: result.content
				}),
				execute: (args, exec) => Promise.resolve(search(state, args.query, args.limit, exec.agent, exec.parent))
			})));
			refreshRestriction(state);
		} catch (error) {
			states.delete(agent);
			mutateRegistry(() => {
				state.removeSearchTool?.();
			});
			throw error;
		}
	}
	/** Lift every registration owned for one exact agent. */
	function uninstall(agent) {
		const state = states.get(agent);
		if (state === void 0) return;
		states.delete(agent);
		mutateRegistry(() => {
			state.liftRestriction?.();
			state.removeSearchTool?.();
		});
	}
	ctx.on("agent/created", ({ agent }) => {
		install(agent);
	});
	ctx.on("agent/disposed", ({ agent }) => {
		uninstall(agent);
	});
	ctx.on("tools/change", () => {
		if (registryMutationDepth > 0) return;
		for (const state of states.values()) {
			refreshCatalog(state);
			refreshRestriction(state);
		}
	});
	for (const agent of ctx.agents.list()) install(agent);
	ctx.effect(() => () => {
		for (const agent of states.keys()) uninstall(agent);
	}, "tool-search: per-agent registrations");
}
//#endregion
export { Config, TOOL_SEARCH_NAME, apply, inject, name };
