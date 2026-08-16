import { settingsNamespace } from "@deepseek-ai/dsh-settings";
import z from "@deepseek-ai/schemastery";
//#region src/settings.ts
/**
* Durable notification preferences shared by the Host schema and the browser
* scope. This module is deliberately free of schemastery so the browser half
* and the test suite can import it without a Host dependency; the schemastery
* wire schema lives in `schema.ts` (Host half only).
*/
/** Settings namespace owned by the notification plugin. */
const NOTIFICATIONS_NS = "dsh-session-notification";
/** The four notification kinds the plugin can raise. */
const NOTIFICATION_TYPES = [
	"completed",
	"failed",
	"question",
	"permission"
];
/**
* The four built-in sound effects. Each notification kind defaults to one of
* them and can be reassigned to any other (or to `none`).
*/
const SOUND_IDS = [
	"chime",
	"fault",
	"pop",
	"alert"
];
/** Default preferences applied when the user document holds no override. */
const DEFAULT_NOTIFICATION_SETTINGS = Object.freeze({
	browserEnabled: false,
	notifyCurrent: false,
	soundEnabled: true,
	volume: .6,
	types: Object.freeze({
		completed: Object.freeze({
			enabled: true,
			sound: "chime"
		}),
		failed: Object.freeze({
			enabled: true,
			sound: "fault"
		}),
		question: Object.freeze({
			enabled: true,
			sound: "pop"
		}),
		permission: Object.freeze({
			enabled: true,
			sound: "alert"
		})
	})
});
/** Default sound per notification kind (the "default four sound effects"). */
const DEFAULT_SOUND = Object.freeze({
	completed: "chime",
	failed: "fault",
	question: "pop",
	permission: "alert"
});
/**
* Narrow one candidate to a sound id.
* @param value - value crossing the settings or wire boundary.
* @returns whether the value is a selectable sound id.
*/
function isSoundId(value) {
	return value === "none" || value === "custom" || SOUND_IDS.some((sound) => sound === value);
}
/**
* Merge an unknown wire section over the defaults, dropping malformed fields
* so a hand-edited user document degrades to the default rather than to a
* broken player configuration.
* @param raw - the raw user-layer section (or undefined when absent).
* @returns a complete, valid settings object.
*/
function resolveNotificationSettings(raw) {
	const source = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
	const typeConfig = (kind) => {
		const entry = source.types;
		const own = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? entry[kind] : void 0;
		const config = typeof own === "object" && own !== null && !Array.isArray(own) ? own : {};
		return {
			enabled: typeof config.enabled === "boolean" ? config.enabled : true,
			sound: isSoundId(config.sound) ? config.sound : DEFAULT_SOUND[kind]
		};
	};
	const volume = typeof source.volume === "number" && Number.isFinite(source.volume) ? Math.min(1, Math.max(0, source.volume)) : DEFAULT_NOTIFICATION_SETTINGS.volume;
	return {
		browserEnabled: typeof source.browserEnabled === "boolean" ? source.browserEnabled : DEFAULT_NOTIFICATION_SETTINGS.browserEnabled,
		notifyCurrent: typeof source.notifyCurrent === "boolean" ? source.notifyCurrent : DEFAULT_NOTIFICATION_SETTINGS.notifyCurrent,
		soundEnabled: typeof source.soundEnabled === "boolean" ? source.soundEnabled : DEFAULT_NOTIFICATION_SETTINGS.soundEnabled,
		volume,
		types: {
			completed: typeConfig("completed"),
			failed: typeConfig("failed"),
			question: typeConfig("question"),
			permission: typeConfig("permission")
		}
	};
}
//#endregion
//#region src/schema.ts
/**
* Schemastery wire schema for the `dsh-session-notification` settings namespace.
* Host-half only: the browser scope validates against the serialized wire
* schema served by the Host, never this module. The schema types the
* PERSISTED shape — `sound` never stores `custom` (custom audio is resolved
* at dispatch time from browser-local storage).
*/
const SOUND_UNION = z.union([
	...SOUND_IDS,
	"custom",
	"none"
]);
const typeSchema = z.object({
	enabled: z.boolean().default(true),
	sound: SOUND_UNION.default("none")
});
/** Durable notification-preferences schema shared by the settings seam. */
const NotificationSettingsSchema = z.object({
	browserEnabled: z.boolean().default(DEFAULT_NOTIFICATION_SETTINGS.browserEnabled),
	notifyCurrent: z.boolean().default(DEFAULT_NOTIFICATION_SETTINGS.notifyCurrent),
	soundEnabled: z.boolean().default(DEFAULT_NOTIFICATION_SETTINGS.soundEnabled),
	volume: z.number().min(0).max(1).default(DEFAULT_NOTIFICATION_SETTINGS.volume),
	types: z.object({
		[NOTIFICATION_TYPES[0]]: typeSchema,
		[NOTIFICATION_TYPES[1]]: typeSchema,
		[NOTIFICATION_TYPES[2]]: typeSchema,
		[NOTIFICATION_TYPES[3]]: typeSchema
	}).default({
		completed: {
			enabled: true,
			sound: "chime"
		},
		failed: {
			enabled: true,
			sound: "fault"
		},
		question: {
			enabled: true,
			sound: "pop"
		},
		permission: {
			enabled: true,
			sound: "alert"
		}
	})
});
//#endregion
//#region src/index.ts
/**
* Register the durable notification section when the settings service is
* composed (the web profile always composes it). Absent the service the
* browser half still runs, falling back to its defaults.
* @param ctx - Host context.
*/
function apply(ctx) {
	ctx.inject(["settings"], (settingsCtx) => {
		settingsCtx.settings.register(settingsNamespace(NOTIFICATIONS_NS), NotificationSettingsSchema);
	});
}
//#endregion
export { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATIONS_NS, NOTIFICATION_TYPES, NotificationSettingsSchema, SOUND_IDS, apply, resolveNotificationSettings };
