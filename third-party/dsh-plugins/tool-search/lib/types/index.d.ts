/**
 * Experimental Native Tool Mode progressive disclosure: each agent keeps a
 * small global tool surface plus a scope-local `tool_search` discovery tool.
 * Search selections are durable whole snapshots and widen only this plugin's
 * restriction, so an independent parent/tool-filter restriction still wins.
 * @module @deepseek-ai/dsh-tool-search
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { type ToolSearchSelection } from './selection.ts';
export type { ToolSearchSelection } from './selection.ts';
declare module '@deepseek-ai/dsh-session' {
    interface SessionEventMap {
        /**
         * Whole per-agent selected-tool snapshot. Each later event is a strict
         * superset; the latest event restores progressive disclosure on resume or fork.
         */
        'tool-search/selection': ToolSearchSelection;
    }
}
/** Cordis plugin name. */
export declare const name = "tool-search";
/** Services required to attach one search surface to every live agent. */
export declare const inject: string[];
/** Model-facing discovery tool name. */
export declare const TOOL_SEARCH_NAME = "tool_search";
/** Per-agent search policy. */
export interface Config {
    /** `*`-wildcard global tool-name patterns that remain directly visible before search. */
    alwaysVisible?: string[];
    /** Maximum tools one search call may return and attempt to load (default 5). */
    maxResults?: number;
    /** Maximum trimmed query length in JavaScript characters (default 512). */
    maxQueryChars?: number;
}
/** Schemastery validation and defaults for {@link Config}. */
export declare const Config: z<Config>;
/**
 * Install progressive disclosure for every current and future agent.
 * @param ctx - plugin context carrying agent and tool registries.
 * @param config - visibility patterns and per-call bounds.
 */
export declare function apply(ctx: Context, config: Config): void;
/** Session event type retained for consumers that need an exact discriminated event. */
export type ToolSearchSelectionEvent = SessionEvent<'tool-search/selection'>;
