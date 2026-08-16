window.__ModuleLoader__.load({
	id: "@dingyi222666/dsh-session-notification",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/settings.ts
		/**
		* Durable notification preferences shared by the Host schema and the browser
		* scope. This module is deliberately free of schemastery so the browser half
		* and the test suite can import it without a Host dependency; the schemastery
		* wire schema lives in `schema.ts` (Host half only).
		*/
		/** Settings namespace owned by the notification plugin. */
		const NOTIFICATIONS_NS = "dsh-session-notification";
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
		//#region src/client/local-settings.ts
		/** localStorage key holding the whole preferences section. */
		const LOCAL_STORAGE_KEY = `${NOTIFICATIONS_NS}:preferences`;
		/** Read the browser storage when present (absent in Node/SSR). */
		function storage() {
			try {
				return typeof localStorage === "undefined" ? void 0 : localStorage;
			} catch {
				return;
			}
		}
		/** Parse one stored section; anything malformed resolves to the defaults. */
		function parseStored(raw) {
			if (raw === null) return void 0;
			try {
				return JSON.parse(raw);
			} catch {
				return;
			}
		}
		/**
		* Create the browser-local scope.
		* @returns a scope whose snapshot is `ready` immediately, backed by
		* localStorage when available and by memory otherwise.
		*/
		function createLocalSettingsScope() {
			const listeners = /* @__PURE__ */ new Set();
			const notify = () => {
				for (const listener of listeners) listener();
			};
			let value = resolveNotificationSettings(parseStored(storage()?.getItem(LOCAL_STORAGE_KEY) ?? null));
			let revision = 1;
			const snapshot = () => ({
				status: "ready",
				value,
				base: DEFAULT_NOTIFICATION_SETTINGS,
				user: void 0,
				revision,
				writable: true,
				mode: "memory"
			});
			const commit = (next, persist) => {
				value = next;
				revision += 1;
				if (persist) try {
					storage()?.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
				} catch {}
				notify();
			};
			if (typeof window !== "undefined") window.addEventListener("storage", (event) => {
				if (event.key !== LOCAL_STORAGE_KEY) return;
				commit(resolveNotificationSettings(parseStored(event.newValue)), false);
			});
			return {
				getSnapshot: snapshot,
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				async set(field, fieldValue) {
					commit(resolveNotificationSettings({
						...value,
						[field]: fieldValue
					}), true);
				},
				async unset(field) {
					const fallback = DEFAULT_NOTIFICATION_SETTINGS[field];
					commit(resolveNotificationSettings({
						...value,
						[field]: fallback
					}), true);
				}
			};
		}
		//#endregion
		//#region src/client/sounds.ts
		/** The four selectable sound effects (the "default four sounds"). */
		const SOUND_PATTERNS = {
			/** 叮咚 — a pleasant ascending two-note chime (E5 → A5). */
			chime: { notes: [{
				at: 0,
				frequency: 659.25,
				duration: .2,
				type: "sine",
				gain: .9
			}, {
				at: .16,
				frequency: 880,
				duration: .4,
				type: "sine",
				gain: .9
			}] },
			/** 低鸣 — a low descending sawtooth pair (A3 → E3). */
			fault: { notes: [{
				at: 0,
				frequency: 220,
				duration: .24,
				type: "sawtooth",
				gain: .45
			}, {
				at: .2,
				frequency: 164.81,
				duration: .42,
				type: "sawtooth",
				gain: .45
			}] },
			/** 轻响 — one short soft triangle pop (A5). */
			pop: { notes: [{
				at: 0,
				frequency: 880,
				duration: .09,
				type: "triangle",
				gain: .8
			}] },
			/** 警示 — a square-wave double beep plus a higher third hit. */
			alert: { notes: [
				{
					at: 0,
					frequency: 660,
					duration: .12,
					type: "square",
					gain: .35
				},
				{
					at: .18,
					frequency: 660,
					duration: .12,
					type: "square",
					gain: .35
				},
				{
					at: .36,
					frequency: 880,
					duration: .24,
					type: "square",
					gain: .35
				}
			] }
		};
		/**
		* Web Audio player. The AudioContext is created lazily on the first play and
		* reused; a suspended context (autoplay policy) is resumed on every play, so
		* sound starts working as soon as the user has interacted with the page.
		*/
		var SoundPlayer = class {
			volume;
			context;
			master;
			/**
			* @param volume - reads the current master volume in [0, 1] at play time.
			*/
			constructor(volume) {
				this.volume = volume;
			}
			/**
			* Play one built-in sound effect.
			* @param sound - the sound id; `none` and `custom` (which plays through
			* {@link playCustom}) play nothing here.
			*/
			play(sound) {
				if (sound === "none" || sound === "custom") return;
				const context = this.ensureContext();
				if (context === void 0 || this.master === void 0) return;
				const pattern = SOUND_PATTERNS[sound];
				const start = context.currentTime + .02;
				this.master.gain.setValueAtTime(clampVolume(this.volume()), start);
				for (const note of pattern.notes) {
					const oscillator = context.createOscillator();
					const gain = context.createGain();
					oscillator.type = note.type;
					oscillator.frequency.value = note.frequency;
					const at = start + note.at;
					gain.gain.setValueAtTime(0, at);
					gain.gain.linearRampToValueAtTime(note.gain, at + .01);
					gain.gain.exponentialRampToValueAtTime(.001, at + note.duration);
					oscillator.connect(gain).connect(this.master);
					oscillator.start(at);
					oscillator.stop(at + note.duration + .05);
				}
			}
			/** Create (or resume) the shared context; undefined outside browsers. */
			ensureContext() {
				if (typeof AudioContext === "undefined") return void 0;
				if (this.context === void 0) {
					this.context = new AudioContext();
					this.master = this.context.createGain();
					this.master.connect(this.context.destination);
				}
				if (this.context.state === "suspended") this.context.resume();
				return this.context;
			}
			/**
			* Play a user-supplied audio file (data URL) at the master volume. Uses an
			* HTMLAudioElement so the browser's native decoder handles mp3/ogg/wav.
			* @param dataUrl - the audio data URL.
			*/
			playCustom(dataUrl) {
				if (typeof Audio === "undefined") return;
				const audio = new Audio(dataUrl);
				audio.volume = clampVolume(this.volume());
				audio.play().catch(() => {});
			}
		};
		/** Clamp a volume candidate to [0, 1] (the settings schema already bounds it). */
		function clampVolume(volume) {
			return Math.min(1, Math.max(0, volume));
		}
		//#endregion
		//#region src/client/browser-notify.ts
		/** The current notification permission state. */
		function browserPermission() {
			if (typeof Notification === "undefined") return "unsupported";
			return Notification.permission;
		}
		/**
		* Request notification permission. A 'default' state triggers the browser's
		* permission prompt — call from a user gesture (the settings toggle click).
		* @returns the resulting permission state.
		*/
		async function requestBrowserPermission() {
			if (typeof Notification === "undefined") return "unsupported";
			let permission = Notification.permission;
			if (permission === "default") permission = await Notification.requestPermission();
			return permission;
		}
		/**
		* Resolve the current page's own icon (favicon) as an absolute URL, preferring
		* the largest declared one (`apple-touch-icon` over `rel=icon`). `link.href`
		* is the resolved absolute URL, so relative favicon paths need no base work.
		* @returns the icon URL, or undefined when the page declares none.
		*/
		function pageIconUrl() {
			if (typeof document === "undefined") return void 0;
			const appleTouch = document.querySelector("link[rel=\"apple-touch-icon\"]");
			if (appleTouch !== null && appleTouch.href.length > 0) return appleTouch.href;
			const icon = document.querySelector("link[rel~=\"icon\"]");
			if (icon !== null && icon.href.length > 0) return icon.href;
		}
		/**
		* Show one system notification, carrying the page's own icon (favicon).
		* Notifications are tagged so a burst of the same event collapses into a
		* single OS-level card. Suppressed notifications log the reason (missing API,
		* missing permission, constructor failure) so a silent "no notification" is
		* diagnosable from the console instead of being swallowed; an icon the
		* browser cannot rasterize falls back to an icon-less notification rather
		* than dropping the alert.
		* @param title - notification title.
		* @param body - notification body.
		* @returns whether a notification was actually shown.
		*/
		function showBrowserNotification(title, body) {
			if (typeof Notification === "undefined") {
				console.warn("[dsh-session-notification] browser Notification API is unavailable (insecure context or unsupported browser)");
				return false;
			}
			if (Notification.permission !== "granted") {
				console.warn(`[dsh-session-notification] browser notification suppressed: permission is "${Notification.permission}"`);
				return false;
			}
			const icon = pageIconUrl();
			try {
				const notification = new Notification(title, {
					body,
					tag: "dsh-session-notification",
					...icon === void 0 ? {} : { icon }
				});
				notification.onclick = () => {
					window.focus();
					notification.close();
				};
				return true;
			} catch (error) {
				if (icon !== void 0) try {
					const notification = new Notification(title, {
						body,
						tag: "dsh-session-notification"
					});
					notification.onclick = () => {
						window.focus();
						notification.close();
					};
					console.warn("[dsh-session-notification] page icon was rejected; notification shown without it", error);
					return true;
				} catch (_secondFailure) {
					console.warn("[dsh-session-notification] Notification constructor failed; check the browser/OS notification settings", _secondFailure);
					return false;
				}
				console.warn("[dsh-session-notification] Notification constructor failed; check the browser/OS notification settings", error);
				return false;
			}
		}
		//#endregion
		//#region src/client/custom-audio.ts
		/** localStorage key for the custom-sound map. */
		const STORAGE_KEY = "dsh-session-notification.customSounds";
		/** Read the whole custom-sound map from localStorage. */
		function readCustomSounds() {
			if (typeof localStorage === "undefined") return {};
			try {
				const raw = localStorage.getItem(STORAGE_KEY);
				if (raw === null) return {};
				const parsed = JSON.parse(raw);
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
				return parsed;
			} catch (_corruptEntry) {
				return {};
			}
		}
		/** Read one kind's custom sound data URL (undefined = none). */
		function readCustomSound(kind) {
			const url = readCustomSounds()[kind];
			return url !== void 0 && url.length > 0 ? url : void 0;
		}
		/** Persist one kind's custom sound (null removes it). */
		function writeCustomSound(kind, dataUrl) {
			if (typeof localStorage === "undefined") return;
			const next = { ...readCustomSounds() };
			if (dataUrl === null) delete next[kind];
			else next[kind] = dataUrl;
			localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
		}
		/** The sound map with one entry replaced (pure helper for store mirrors). */
		function withCustomSound(current, kind, dataUrl) {
			const next = { ...current };
			if (dataUrl === null) delete next[kind];
			else next[kind] = dataUrl;
			return next;
		}
		/** Read a picked audio file as a data URL (the stored custom-sound form). */
		function readFileAsDataUrl(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					const result = reader.result;
					if (typeof result === "string") resolve(result);
					else reject(/* @__PURE__ */ new Error("audio file read produced no data URL"));
				};
				reader.onerror = () => {
					reject(reader.error ?? /* @__PURE__ */ new Error("audio file read failed"));
				};
				reader.readAsDataURL(file);
			});
		}
		//#endregion
		//#region src/client/notification-service.ts
		/**
		* Classifies session lifecycle edges into notification events. Edges are
		* observed on the sessions-list snapshot: a running true→false transition
		* arms a classification (completed vs failed) after the settle window; a
		* pending-interaction arrival raises the question/permission kinds. A session
		* that was already idle when observation started raises nothing.
		*/
		var NotificationEngine = class {
			ports;
			prev = /* @__PURE__ */ new Map();
			runs = /* @__PURE__ */ new Map();
			settling = /* @__PURE__ */ new Set();
			/** @param ports - injected readers and sink. */
			constructor(ports) {
				this.ports = ports;
			}
			/**
			* Process one sessions-list snapshot (called on every list change).
			* @param sessions - the latest list snapshot.
			*/
			observe(sessions) {
				const seen = /* @__PURE__ */ new Set();
				for (const summary of Object.values(sessions.byId)) {
					const id = summary.id;
					seen.add(id);
					const prev = this.prev.get(id) ?? {
						running: false,
						pending: void 0
					};
					if (summary.pendingInteraction !== prev.pending) {
						if (summary.pendingInteraction === "question") this.raise("question", id);
						else if (summary.pendingInteraction === "approval") this.raise("permission", id);
						prev.pending = summary.pendingInteraction;
					}
					if (prev.running && !summary.running) this.settleRun(id);
					else if (!prev.running && summary.running) this.armRun(id);
					prev.running = summary.running;
					this.prev.set(id, prev);
				}
				for (const id of this.prev.keys()) if (!seen.has(id)) {
					this.prev.delete(id);
					this.runs.delete(id);
				}
			}
			/**
			* Establish the baseline before live observation: record every session's
			* current signal and arm runs already in progress, but raise nothing —
			* pending interactions and idle sessions that predate the plugin raise no
			* notification.
			* @param sessions - the first list snapshot.
			*/
			seed(sessions) {
				for (const summary of Object.values(sessions.byId)) {
					const id = summary.id;
					this.prev.set(id, {
						running: summary.running,
						pending: summary.pendingInteraction
					});
					if (summary.running) this.armRun(id);
				}
			}
			/** Capture the pre-run failure baseline when a run starts. */
			armRun(id) {
				const detail = this.ports.detailOf(id);
				this.runs.set(id, {
					baselineErrorSeq: detail?.maxTurnErrorSeq ?? 0,
					baselineAgentError: detail?.lastAgentError ?? null
				});
			}
			/** Classify a finished run after the settle window (completed vs failed). */
			async settleRun(id) {
				const run = this.runs.get(id);
				if (run === void 0 || this.settling.has(id)) return;
				this.runs.delete(id);
				this.settling.add(id);
				try {
					await this.ports.settle();
					if (this.runs.has(id)) return;
					const detail = this.ports.detailOf(id);
					const failed = detail !== void 0 && (detail.maxTurnErrorSeq > run.baselineErrorSeq || detail.lastAgentError !== null && detail.lastAgentError !== run.baselineAgentError);
					const message = failed ? detail?.failureMessage ?? detail?.lastAgentError ?? "" : detail?.finalText ?? "";
					this.ports.emit({
						kind: failed ? "failed" : "completed",
						sessionId: id,
						title: this.ports.titleOf(id),
						detail: message
					});
				} finally {
					this.settling.delete(id);
				}
			}
			/** Raise the question/permission kind on a pending-interaction edge. */
			raise(kind, id) {
				const pending = this.ports.detailOf(id)?.pending ?? [];
				this.ports.emit({
					kind,
					sessionId: id,
					title: this.ports.titleOf(id),
					detail: kind === "question" ? questionText(pending) : approvalText(pending)
				});
			}
		};
		/** Extract the first question text from a session's pending interactions. */
		function questionText(pending) {
			for (const item of pending) {
				if (item.kind !== "question") continue;
				const first = item.payload.questions[0];
				if (first !== void 0 && first.question.length > 0) return first.question;
			}
			return "";
		}
		/** Extract the tool name (+ reason) from a session's pending approvals. */
		function approvalText(pending) {
			for (const item of pending) {
				if (item.kind !== "approval") continue;
				const { toolName, reason } = item.payload;
				return reason !== void 0 && reason.length > 0 ? `${toolName}：${reason}` : toolName;
			}
			return "";
		}
		/**
		* Project one conversation snapshot into the engine's {@link SessionDetail}.
		* The final completion text is the joined text of the last assistant step
		* (the chat view's `assistant-step` node) that carries any.
		* @param snapshot - the session's current conversation snapshot.
		* @returns the derived detail.
		*/
		function sessionDetailOf(snapshot) {
			let maxTurnErrorSeq = 0;
			let failureMessage = null;
			let finalText = "";
			for (const node of snapshot.chat.nodes.values()) if (node.kind === "turn-error") {
				const data = node.data;
				if (data.seq > maxTurnErrorSeq) {
					maxTurnErrorSeq = data.seq;
					failureMessage = data.message;
				}
			} else if (node.kind === "assistant-step") {
				const text = node.data.blocks.filter((block) => block.kind === "text").map((block) => block.text).join("");
				if (text.length > 0) finalText = text;
			}
			return {
				maxTurnErrorSeq,
				failureMessage,
				lastAgentError: snapshot.lastAgentError,
				pending: snapshot.pending,
				finalText
			};
		}
		/** Cap the detail text shown in a notification. */
		function truncateDetail(text, max = 160) {
			if (text.length <= max) return text;
			return `${text.slice(0, max - 1)}…`;
		}
		/**
		* Applies the durable preferences to one classified event. The session you
		* are reading stays quiet by default: while it is current and the tab is
		* visible, nothing fires unless the `notifyCurrent` toggle opts it in.
		* Otherwise the kind's effective sound (the uploaded custom audio when the
		* picker selects 自定义, else the selected built-in) plays when sound is
		* enabled, and a system notification shows when browser notifications are
		* enabled and the user is not looking at that session (backgrounded, or
		* focused elsewhere).
		*/
		var NotificationDispatcher = class {
			deps;
			/** @param deps - injected readers and sinks. */
			constructor(deps) {
				this.deps = deps;
			}
			/**
			* Dispatch one event.
			* @param event - the classified event.
			*/
			dispatch(event) {
				const settings = this.deps.settings();
				const type = settings.types[event.kind];
				if (!type.enabled) return;
				const isCurrent = this.deps.currentSession() === event.sessionId;
				const hidden = this.deps.isHidden();
				if (isCurrent && !hidden && !settings.notifyCurrent) return;
				const title = this.deps.t(`notify.${event.kind}.title`);
				const template = this.deps.t(`notify.${event.kind}.body`);
				const detail = truncateDetail(event.detail);
				const base = template.replaceAll("{title}", event.title);
				const body = event.kind === "completed" ? detail.length > 0 ? `${base}\n${detail}` : base : base.replaceAll("{detail}", detail);
				if (settings.soundEnabled) {
					if (type.sound === "custom") {
						const customUrl = this.deps.customSoundOf(event.kind);
						if (customUrl !== void 0) this.deps.playSound("custom", customUrl);
					} else if (type.sound !== "none") this.deps.playSound(type.sound);
				}
				if (!settings.browserEnabled) return;
				if (hidden || !isCurrent || settings.notifyCurrent) this.deps.showBrowser(title, body);
			}
		};
		//#endregion
		//#region src/client/settings-store.ts
		/**
		* Notifications settings section store: a mirror of the plugin's
		* browser-local preferences scope, plus the write actions the section's
		* inject face exposes. The slot renderer owns the store instance and hands
		* its bound actions to the inject factory (the ui-theme row pattern); the
		* apply world syncs accepted scope snapshots through those actions. Component
		* reads go through `useStore`.
		*/
		/**
		* Declares the Notifications section state and write surface.
		* @returns the store handle.
		*/
		function createNotificationsStore() {
			return (0, _deepseek_ai_dsh_client_runtime_client.defineStore)({
				init: () => ({
					status: "loading",
					writable: false,
					settings: DEFAULT_NOTIFICATION_SETTINGS,
					permission: browserPermission(),
					customSounds: readCustomSounds()
				}),
				actions: {
					adopt: (draft, snapshot) => {
						draft.status = snapshot.status;
						draft.writable = snapshot.writable;
						if (snapshot.status === "ready" && snapshot.value !== void 0) draft.settings = snapshot.value;
					},
					setBrowserEnabled: (draft, enabled) => {
						draft.settings = {
							...draft.settings,
							browserEnabled: enabled
						};
					},
					setNotifyCurrent: (draft, enabled) => {
						draft.settings = {
							...draft.settings,
							notifyCurrent: enabled
						};
					},
					setSoundEnabled: (draft, enabled) => {
						draft.settings = {
							...draft.settings,
							soundEnabled: enabled
						};
					},
					setVolume: (draft, volume) => {
						draft.settings = {
							...draft.settings,
							volume
						};
					},
					setType: (draft, kind, patch) => {
						draft.settings = {
							...draft.settings,
							types: {
								...draft.settings.types,
								[kind]: {
									...draft.settings.types[kind],
									...patch
								}
							}
						};
					},
					setPermission: (draft, permission) => {
						draft.permission = permission;
					},
					setCustomSound: (draft, kind, dataUrl) => {
						draft.customSounds = withCustomSound(draft.customSounds, kind, dataUrl);
					}
				}
			});
		}
		//#endregion
		//#region \0dsh-css:/home/yash/Agent/project/deepseek-harness/third-party/dsh-plugins/session-notification/src/client/NotificationsSection.module.css.mjs
		const css = ".fqe2Zq_section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}.fqe2Zq_title{color:var(--dsw-alias-label-primary);margin:0;font-size:18px;font-weight:600;line-height:28px}.fqe2Zq_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}.fqe2Zq_rows{flex-direction:column;margin:8px 0 0;padding:0;list-style:none;display:flex}.fqe2Zq_row{border-bottom:1px solid var(--dsw-alias-border-l2);flex-wrap:wrap;align-items:center;gap:10px;padding:14px 0;display:flex}.fqe2Zq_row:last-child{border-bottom:none}.fqe2Zq_rowIcon{color:var(--dsw-alias-label-tertiary);flex:none}.fqe2Zq_rowText{flex-direction:column;flex:180px;gap:2px;min-width:0;display:flex}.fqe2Zq_rowTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}.fqe2Zq_desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.fqe2Zq_rowActions{align-items:center;gap:6px;margin-left:auto;display:inline-flex}.fqe2Zq_permissionState{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.fqe2Zq_actionButton{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;border-radius:14px;justify-content:center;align-items:center;gap:4px;padding:0 10px;font-size:12px;line-height:18px;display:inline-flex}.fqe2Zq_actionButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.fqe2Zq_iconButton{box-sizing:border-box;width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:6px;justify-content:center;align-items:center;display:inline-flex}.fqe2Zq_iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.fqe2Zq_iconButtonDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}.fqe2Zq_actionButton:focus-visible,.fqe2Zq_iconButton:focus-visible,.fqe2Zq_selector:focus-visible,.fqe2Zq_slider:focus-visible,.fqe2Zq_switch:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}.fqe2Zq_selector{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);height:28px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border-radius:14px;align-items:center;gap:8px;padding:0 10px;font-size:12px;line-height:18px;display:inline-flex}.fqe2Zq_selector:hover{background:var(--dsw-alias-interactive-bg-hover)}.fqe2Zq_chevron{color:var(--dsw-alias-label-tertiary)}.fqe2Zq_switch{cursor:pointer;background:0 0;border:0;border-radius:0;flex:none;justify-content:center;align-items:center;width:32px;height:20px;padding:0;display:inline-flex}.fqe2Zq_switchTrack{background:var(--dsw-alias-border-l2);width:28px;height:16px;transition:background-color .12s var(--ds-ease-in-out);border-radius:8px;flex:none;display:inline-block;position:relative}.fqe2Zq_switchThumb{background:var(--dsw-alias-bg-layer-1);width:12px;height:12px;transition:transform .12s var(--ds-ease-in-out);border-radius:50%;position:absolute;top:2px;left:2px}.fqe2Zq_switchTrack[data-on=true]{background:var(--dsw-alias-state-business-primary)}.fqe2Zq_switchTrack[data-on=true] .fqe2Zq_switchThumb{transform:translate(12px)}.fqe2Zq_volumeControl{align-items:center;gap:8px;display:inline-flex}.fqe2Zq_slider{cursor:pointer;touch-action:none;width:140px;height:20px;position:relative}.fqe2Zq_sliderRail{background:var(--dsw-alias-border-l2);border-radius:2px;height:4px;position:absolute;top:50%;left:0;right:0;transform:translateY(-50%)}.fqe2Zq_sliderFill{background:var(--dsw-alias-state-business-primary);border-radius:2px;height:4px;position:absolute;top:50%;left:0;transform:translateY(-50%)}.fqe2Zq_sliderThumb{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:50%;width:14px;height:14px;position:absolute;top:50%;transform:translate(-50%,-50%)}.fqe2Zq_volumeValue{min-width:36px;color:var(--dsw-alias-label-tertiary);text-align:right;font-size:12px;line-height:18px}.fqe2Zq_fileInput{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}@media (prefers-reduced-motion:reduce){.fqe2Zq_switchTrack{transition:none}}";
		const tagId = "@dingyi222666/dsh-session-notification/NotificationsSection.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@dingyi222666/dsh-session-notification";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var NotificationsSection_module_css_default = {
			"row": "fqe2Zq_row",
			"desc": "fqe2Zq_desc",
			"permissionState": "fqe2Zq_permissionState",
			"switchTrack": "fqe2Zq_switchTrack",
			"iconButton": "fqe2Zq_iconButton",
			"rowText": "fqe2Zq_rowText",
			"rowIcon": "fqe2Zq_rowIcon",
			"intro": "fqe2Zq_intro",
			"section": "fqe2Zq_section",
			"rows": "fqe2Zq_rows",
			"actionButton": "fqe2Zq_actionButton",
			"slider": "fqe2Zq_slider",
			"chevron": "fqe2Zq_chevron",
			"sliderRail": "fqe2Zq_sliderRail",
			"title": "fqe2Zq_title",
			"iconButtonDanger": "fqe2Zq_iconButtonDanger",
			"volumeValue": "fqe2Zq_volumeValue",
			"selector": "fqe2Zq_selector",
			"sliderThumb": "fqe2Zq_sliderThumb",
			"sliderFill": "fqe2Zq_sliderFill",
			"rowActions": "fqe2Zq_rowActions",
			"fileInput": "fqe2Zq_fileInput",
			"switch": "fqe2Zq_switch",
			"volumeControl": "fqe2Zq_volumeControl",
			"rowTitle": "fqe2Zq_rowTitle",
			"switchThumb": "fqe2Zq_switchThumb"
		};
		//#endregion
		//#region src/client/NotificationsSection.tsx
		/**
		* Notifications settings section: the `settings.section` entry owned by the
		* notification plugin, in the settings-panel design language (models-page
		* vocabulary: 16/24 section title, 14/22 row names, 12/18 captions, capsule
		* controls). Master rows (browser notifications, sound, volume) plus one flat
		* hairline row per notification kind — each with an enable switch, the
		* kind's sound picker (the official Menu), a custom-audio upload, and a
		* preview button. All copy rides the standard locale seat; reads go through
		* `useStore`, business writes through the injected controller callbacks.
		*/
		/** Kind row metadata: icon, copy keys. */
		const KIND_ROWS = [
			{
				kind: "completed",
				Icon: _deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16,
				title: "type.completed.title",
				desc: "type.completed.desc"
			},
			{
				kind: "failed",
				Icon: _deepseek_ai_dsh_client_ui_primitives.IconWarningOutline16,
				title: "type.failed.title",
				desc: "type.failed.desc"
			},
			{
				kind: "question",
				Icon: _deepseek_ai_dsh_client_ui_primitives.IconQuestionOutline14,
				title: "type.question.title",
				desc: "type.question.desc"
			},
			{
				kind: "permission",
				Icon: _deepseek_ai_dsh_client_ui_primitives.IconAgentPresetOutline16,
				title: "type.permission.title",
				desc: "type.permission.desc"
			}
		];
		/** Sound menu entries: the four effects, Custom, then None. */
		const SOUND_OPTIONS = [
			...SOUND_IDS,
			"custom",
			"none"
		];
		/** Copy key for each sound id (type-safe dynamic lookup for the Menu). */
		const SOUND_KEY = {
			chime: "sound.chime",
			fault: "sound.fault",
			pop: "sound.pop",
			alert: "sound.alert",
			none: "sound.none",
			custom: "sound.custom"
		};
		/** Official switch: role=switch button with a track + thumb. */
		function Switch({ on, label, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: NotificationsSection_module_css_default.switch,
				role: "switch",
				"aria-checked": on,
				"aria-label": label,
				onClick: () => {
					onChange(!on);
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: NotificationsSection_module_css_default.switchTrack,
					"data-on": on || void 0,
					"aria-hidden": "true",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: NotificationsSection_module_css_default.switchThumb })
				})
			});
		}
		/**
		* Official-style volume slider (no native range input): a track with a
		* filled portion and a draggable thumb, driven by pointer and keyboard.
		*/
		function VolumeSlider({ value, label, onChange }) {
			const trackRef = (0, react.useRef)(null);
			const [dragging, setDragging] = (0, react.useState)(false);
			const valueFromClientX = (clientX) => {
				const rect = trackRef.current?.getBoundingClientRect();
				if (rect === void 0 || rect.width === 0) return value;
				const ratio = (clientX - rect.left) / rect.width;
				return Math.min(1, Math.max(0, ratio));
			};
			const commit = (clientX) => {
				onChange(Math.round(valueFromClientX(clientX) * 20) / 20);
			};
			const onPointerDown = (event) => {
				setDragging(true);
				event.currentTarget.setPointerCapture(event.pointerId);
				commit(event.clientX);
			};
			const onPointerMove = (event) => {
				if (dragging) commit(event.clientX);
			};
			const onKeyDown = (event) => {
				const step = .05;
				if (event.key === "ArrowRight" || event.key === "ArrowUp") {
					event.preventDefault();
					onChange(Math.min(1, value + step));
				} else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
					event.preventDefault();
					onChange(Math.max(0, value - step));
				} else if (event.key === "Home") {
					event.preventDefault();
					onChange(0);
				} else if (event.key === "End") {
					event.preventDefault();
					onChange(1);
				}
			};
			const percent = Math.round(value * 100);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: NotificationsSection_module_css_default.volumeControl,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					ref: trackRef,
					className: NotificationsSection_module_css_default.slider,
					role: "slider",
					"aria-label": label,
					"aria-valuemin": 0,
					"aria-valuemax": 100,
					"aria-valuenow": percent,
					tabIndex: 0,
					onPointerDown,
					onPointerMove,
					onPointerUp: () => {
						setDragging(false);
					},
					onPointerCancel: () => {
						setDragging(false);
					},
					onKeyDown,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: NotificationsSection_module_css_default.sliderRail,
							"aria-hidden": "true"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: NotificationsSection_module_css_default.sliderFill,
							style: { width: `${percent}%` },
							"aria-hidden": "true"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: NotificationsSection_module_css_default.sliderThumb,
							style: { left: `${percent}%` },
							"aria-hidden": "true"
						})
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: NotificationsSection_module_css_default.volumeValue,
					children: [percent, "%"]
				})]
			});
		}
		/**
		* Render the Notifications settings section.
		* @param props - composed slot props.
		*/
		function NotificationsSection({ t, useStore, setBrowserEnabled, setNotifyCurrent, setSoundEnabled, setVolume, setType, testSound, requestPermission, testBrowserNotification, uploadCustomSound }) {
			const { settings, permission, customSounds } = useStore((state) => state);
			const deniedLabel = permission === "denied" ? t("permission.denied") : void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: NotificationsSection_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: NotificationsSection_module_css_default.title,
						children: t("section.title")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: NotificationsSection_module_css_default.intro,
						children: t("section.intro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("ul", {
						className: NotificationsSection_module_css_default.rows,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: NotificationsSection_module_css_default.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: NotificationsSection_module_css_default.rowText,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: NotificationsSection_module_css_default.rowTitle,
										children: t("browser.title")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: NotificationsSection_module_css_default.desc,
										children: t("browser.desc")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: NotificationsSection_module_css_default.rowActions,
									children: [
										permission === "granted" && settings.browserEnabled && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: NotificationsSection_module_css_default.actionButton,
											onClick: testBrowserNotification,
											children: t("test.send")
										}),
										deniedLabel !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: NotificationsSection_module_css_default.permissionState,
											children: deniedLabel
										}),
										permission === "unsupported" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: NotificationsSection_module_css_default.permissionState,
											children: t("permission.unsupported")
										}),
										permission === "default" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: NotificationsSection_module_css_default.actionButton,
											onClick: () => {
												requestPermission();
											},
											children: t("permission.request")
										}),
										settings.browserEnabled && permission !== "granted" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: NotificationsSection_module_css_default.permissionState,
											children: t("permission.paused")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
											on: settings.browserEnabled,
											label: t("browser.title"),
											onChange: (next) => {
												setBrowserEnabled(next);
											}
										})
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: NotificationsSection_module_css_default.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: NotificationsSection_module_css_default.rowText,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: NotificationsSection_module_css_default.rowTitle,
										children: t("current.title")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: NotificationsSection_module_css_default.desc,
										children: t("current.desc")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: NotificationsSection_module_css_default.rowActions,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
										on: settings.notifyCurrent,
										label: t("current.title"),
										onChange: setNotifyCurrent
									})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: NotificationsSection_module_css_default.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: NotificationsSection_module_css_default.rowText,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: NotificationsSection_module_css_default.rowTitle,
										children: t("sound.title")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: NotificationsSection_module_css_default.desc,
										children: t("sound.desc")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: NotificationsSection_module_css_default.rowActions,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
										on: settings.soundEnabled,
										label: t("sound.title"),
										onChange: setSoundEnabled
									})
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
								className: NotificationsSection_module_css_default.row,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: NotificationsSection_module_css_default.rowText,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: NotificationsSection_module_css_default.rowTitle,
										children: t("volume.title")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: NotificationsSection_module_css_default.desc,
										children: t("volume.desc")
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: NotificationsSection_module_css_default.rowActions,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(VolumeSlider, {
										value: settings.volume,
										label: t("volume.title"),
										onChange: setVolume
									})
								})]
							}),
							KIND_ROWS.map(({ kind, Icon, title, desc }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TypeRow, {
								kind,
								Icon,
								title: t(title),
								desc: t(desc),
								type: settings.types[kind],
								customUrl: customSounds[kind],
								t,
								onTypeChange: (patch) => {
									setType(kind, patch);
								},
								onTest: () => {
									const customUrl = customSounds[kind];
									if (settings.types[kind].sound === "custom" && customUrl !== void 0 && customUrl.length > 0) testSound("custom", customUrl);
									else if (settings.types[kind].sound !== "none") testSound(settings.types[kind].sound);
								},
								onUpload: (file) => {
									uploadCustomSound(kind, file);
								}
							}, kind))
						]
					})
				]
			});
		}
		/** One notification-kind row: icon, copy, preview, picker (Custom included), switch. */
		function TypeRow({ kind, Icon, title, desc, type, customUrl, t, onTypeChange, onTest, onUpload }) {
			const fileRef = (0, react.useRef)(null);
			const hasCustom = customUrl !== void 0 && customUrl.length > 0;
			const customSelected = type.sound === "custom";
			const audible = customSelected && hasCustom || type.sound !== "none" && type.sound !== "custom";
			/** Selecting 自定义 with no file yet opens the picker; with a file it just
			*  selects. The uploaded file's handler persists the selection afterwards. */
			const handleSoundSelect = (sound) => {
				if (sound === "custom" && !hasCustom) {
					fileRef.current?.click();
					return;
				}
				onTypeChange({ sound });
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
				className: NotificationsSection_module_css_default.row,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Icon, {
						className: NotificationsSection_module_css_default.rowIcon,
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: NotificationsSection_module_css_default.rowText,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: NotificationsSection_module_css_default.rowTitle,
							children: title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: NotificationsSection_module_css_default.desc,
							children: desc
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: NotificationsSection_module_css_default.rowActions,
						children: [
							customSelected && hasCustom && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: NotificationsSection_module_css_default.actionButton,
								onClick: () => {
									fileRef.current?.click();
								},
								children: t("custom.replace")
							}),
							audible && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: NotificationsSection_module_css_default.actionButton,
								onClick: onTest,
								children: t("test.play")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SoundMenu, {
								value: type.sound,
								t,
								onSelect: handleSoundSelect
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
								on: type.enabled,
								label: title,
								onChange: (next) => {
									onTypeChange({ enabled: next });
								}
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
						ref: fileRef,
						className: NotificationsSection_module_css_default.fileInput,
						type: "file",
						accept: "audio/*",
						"aria-label": t("sound.custom"),
						onChange: (event) => {
							const file = event.currentTarget.files?.[0];
							if (file !== void 0) onUpload(file);
							event.currentTarget.value = "";
						}
					})
				]
			});
		}
		/** One kind's sound picker (the official Menu). */
		function SoundMenu({ value, onSelect, t }) {
			const [open, setOpen] = (0, react.useState)(false);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
				open,
				onClose: () => {
					setOpen(false);
				},
				items: SOUND_OPTIONS.map((sound) => ({
					id: sound,
					label: t(SOUND_KEY[sound])
				})),
				selectedId: value,
				onSelect: (id) => {
					setOpen(false);
					onSelect(id);
				},
				align: "end",
				portal: true,
				anchor: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: NotificationsSection_module_css_default.selector,
					"aria-haspopup": "menu",
					"aria-expanded": open,
					"aria-label": t("sound.title"),
					onClick: () => {
						setOpen((value) => !value);
					},
					children: [t(SOUND_KEY[value]), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronDownOutline14, { className: NotificationsSection_module_css_default.chevron })]
				})
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/**
		* Notification plugin copy. Chinese is the source of truth; English mirrors
		* it key-for-key (the locale gate refuses an asymmetric pair).
		*/
		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"nav": "通知",
			"section.title": "通知",
			"section.intro": "配置会话状态的通知与提示音。",
			"browser.title": "浏览器通知",
			"browser.desc": "离开当前标签页时，在系统里弹通知；首次开启需要授权。",
			"current.title": "当前会话也提醒",
			"current.desc": "开启后，正在看的这个会话完成、出错时也会响（默认不打扰你正在读的对话）。",
			"sound.title": "提示音",
			"sound.desc": "有通知时播放声音。",
			"volume.title": "音量",
			"volume.desc": "提示音整体音量。",
			"type.completed.title": "会话完成",
			"type.completed.desc": "一轮会话正常结束时提醒。",
			"type.failed.title": "会话失败",
			"type.failed.desc": "一轮会话出错中断时提醒。",
			"type.question.title": "问问题",
			"type.question.desc": "Agent 正在向你提问、等待回答时提醒。",
			"type.permission.title": "权限请求",
			"type.permission.desc": "Agent 请求执行需要授权的操作时提醒。",
			"sound.none": "无",
			"sound.chime": "叮咚",
			"sound.fault": "低鸣",
			"sound.pop": "轻响",
			"sound.alert": "警示",
			"sound.custom": "自定义",
			"test.play": "试听",
			"permission.granted": "已授权",
			"permission.denied": "已拒绝",
			"permission.unsupported": "当前环境不支持浏览器通知",
			"permission.paused": "通知已暂停：缺少浏览器权限",
			"permission.request": "授权",
			"test.send": "测试通知",
			"test.notification.title": "通知测试",
			"test.notification.body": "浏览器通知通道工作正常。",
			"custom.replace": "更换",
			"notify.completed.title": "会话完成",
			"notify.completed.body": "「{title}」已完成",
			"notify.failed.title": "会话失败",
			"notify.failed.body": "「{title}」运行失败：{detail}",
			"notify.question.title": "等待回答",
			"notify.question.body": "「{title}」向你提问：{detail}",
			"notify.permission.title": "权限请求",
			"notify.permission.body": "「{title}」请求权限：{detail}"
		};
		/** English dictionary, checked complete against the zh key set. */
		const en = {
			"nav": "Notifications",
			"section.title": "Notifications",
			"section.intro": "Configure notifications and sounds for session states.",
			"browser.title": "Browser notifications",
			"browser.desc": "Show a system notification when you leave the tab; enabling this asks for permission first.",
			"current.title": "Alert for the current session",
			"current.desc": "When on, the session you are reading also alerts when it finishes or fails (by default it stays quiet so you are not interrupted).",
			"sound.title": "Sound",
			"sound.desc": "Play a sound when a notification fires.",
			"volume.title": "Volume",
			"volume.desc": "Master volume for notification sounds.",
			"type.completed.title": "Session completed",
			"type.completed.desc": "Alert when a turn finishes normally.",
			"type.failed.title": "Session failed",
			"type.failed.desc": "Alert when a turn breaks with an error.",
			"type.question.title": "Question asked",
			"type.question.desc": "Alert when the agent is asking you a question.",
			"type.permission.title": "Permission requested",
			"type.permission.desc": "Alert when the agent requests an authorized operation.",
			"sound.none": "None",
			"sound.chime": "Chime",
			"sound.fault": "Fault",
			"sound.pop": "Pop",
			"sound.alert": "Alert",
			"sound.custom": "Custom",
			"test.play": "Preview",
			"permission.granted": "Granted",
			"permission.denied": "Denied",
			"permission.unsupported": "Browser notifications are not supported here",
			"permission.paused": "Notifications paused: browser permission missing",
			"permission.request": "Enable",
			"test.send": "Test notification",
			"test.notification.title": "Notification test",
			"test.notification.body": "The browser notification channel works.",
			"custom.replace": "Replace",
			"notify.completed.title": "Session completed",
			"notify.completed.body": "“{title}” has completed",
			"notify.failed.title": "Session failed",
			"notify.failed.body": "“{title}” failed: {detail}",
			"notify.question.title": "Answer needed",
			"notify.question.body": "“{title}” asks you: {detail}",
			"notify.permission.title": "Permission requested",
			"notify.permission.body": "“{title}” requests permission: {detail}"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "notifications";
		/** How long a finished run waits for trailing wire frames before classification. */
		const SETTLE_MS = 250;
		/** Required services: the slot registry, dictionaries, and the session list. */
		const inject = [
			"slots",
			"locale",
			"sessions"
		];
		/**
		* Client plugin body: bind the browser-local preferences scope, register the
		* Notifications section, and watch the sessions list for notification events.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-session-notification: dictionaries");
			const scope = createLocalSettingsScope();
			const store = createNotificationsStore();
			let bound;
			const currentSettings = () => {
				const snapshot = scope.getSnapshot();
				return snapshot.status === "ready" && snapshot.value !== void 0 ? snapshot.value : DEFAULT_NOTIFICATION_SETTINGS;
			};
			ctx.effect(() => scope.subscribe(() => {
				bound?.adopt(scope.getSnapshot());
			}), "dsh-session-notification: scope adoption");
			const player = new SoundPlayer(() => currentSettings().volume);
			const t = ctx.locale.bind(NS);
			const translate = (key) => t(key);
			/** Play the effective sound: a custom audio when one is supplied, else the built-in. */
			const playEffective = (sound, customUrl) => {
				if (sound === "custom" && customUrl !== void 0) player.playCustom(customUrl);
				else player.play(sound);
			};
			const dispatcher = new NotificationDispatcher({
				settings: currentSettings,
				t: translate,
				playSound: (sound, customUrl) => {
					playEffective(sound, customUrl);
				},
				customSoundOf: (kind) => readCustomSound(kind),
				showBrowser: (title, body) => showBrowserNotification(title, body),
				currentSession: () => ctx.sessions.list.getSnapshot().current,
				isHidden: () => typeof document === "undefined" ? false : document.visibilityState === "hidden"
			});
			const engine = new NotificationEngine({
				detailOf: (id) => {
					const binding = ctx.sessions.binding(id);
					return binding === void 0 ? void 0 : sessionDetailOf(binding.session.getSnapshot());
				},
				titleOf: (id) => ctx.sessions.list.getSnapshot().byId[id]?.displayTitle ?? id,
				settle: () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
				emit: (event) => {
					dispatcher.dispatch(event);
				}
			});
			ctx.effect(() => {
				const unsubscribe = ctx.sessions.list.subscribe(() => engine.observe(ctx.sessions.list.getSnapshot()));
				engine.seed(ctx.sessions.list.getSnapshot());
				return unsubscribe;
			}, "dsh-session-notification: session watch");
			/** Persist one top-level preference through the scope, mirroring optimistically. */
			const persist = (field, value) => {
				if (field === "browserEnabled") bound?.setBrowserEnabled(value);
				else if (field === "notifyCurrent") bound?.setNotifyCurrent(value);
				else if (field === "soundEnabled") bound?.setSoundEnabled(value);
				else bound?.setVolume(value);
				scope.set(field, value);
			};
			/** Persist one per-kind preference (the whole `types` section is one field). */
			const persistType = (kind, patch) => {
				const next = {
					...currentSettings().types[kind],
					...patch
				};
				bound?.setType(kind, patch);
				scope.set("types", {
					...currentSettings().types,
					[kind]: next
				});
			};
			const injected = (actions) => {
				bound = actions;
				bound.adopt(scope.getSnapshot());
				return {
					setBrowserEnabled: async (enabled) => {
						if (enabled) {
							let permission = browserPermission();
							if (permission === "default") {
								permission = await requestBrowserPermission();
								bound?.setPermission(permission);
							}
							if (permission !== "granted") return;
						}
						persist("browserEnabled", enabled);
					},
					setNotifyCurrent: (enabled) => {
						persist("notifyCurrent", enabled);
					},
					setSoundEnabled: (enabled) => {
						persist("soundEnabled", enabled);
					},
					setVolume: (volume) => {
						persist("volume", Math.min(1, Math.max(0, volume)));
					},
					setType: (kind, patch) => {
						persistType(kind, patch);
					},
					testSound: (sound, customUrl) => {
						playEffective(sound, customUrl);
					},
					requestPermission: async () => {
						bound?.setPermission(await requestBrowserPermission());
					},
					testBrowserNotification: () => {
						showBrowserNotification(t("test.notification.title"), t("test.notification.body"));
					},
					uploadCustomSound: async (kind, file) => {
						if (file.size > 1048576) return;
						const dataUrl = await readFileAsDataUrl(file);
						writeCustomSound(kind, dataUrl);
						bound?.setCustomSound(kind, dataUrl);
						persistType(kind, { sound: "custom" });
					}
				};
			};
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "notifications",
				order: 40,
				label: () => t("nav"),
				store,
				locale: NS,
				inject: injected
			}, NotificationsSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map