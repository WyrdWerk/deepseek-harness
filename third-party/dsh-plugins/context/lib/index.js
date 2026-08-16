// src/host/timeline.ts
import { z } from "zod";

// src/host/pricing.ts
var CHARS_PER_TOKEN = 4;
var BLOCK_OVERHEAD = 4;
var ROLE_OVERHEAD = 4;
function estimateToolsTotal(tools) {
  return tools.length > 0 ? Math.ceil(JSON.stringify(tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD : 0;
}
function estimateBlocks(blocks) {
  let tokens = 0;
  if (!Array.isArray(blocks)) return 0;
  for (const block of blocks) {
    if (block === null || typeof block !== "object") continue;
    switch (block.type) {
      case "text":
      case "reasoning":
        tokens += Math.ceil(String(block.text || "").length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
        break;
      case "tool-call":
        tokens += Math.ceil(String(block.name || "").length / CHARS_PER_TOKEN) + Math.ceil(String(block.arguments || "").length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
        break;
      case "tool-result":
        tokens += estimateBlocks(block.content) + BLOCK_OVERHEAD;
        break;
      default:
        tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN);
    }
  }
  return tokens;
}
function estimateMessage(message, emptyIsZero = false) {
  if (emptyIsZero && (message === null || message === void 0 || !Array.isArray(message.content) || message.content.length === 0)) {
    return 0;
  }
  return estimateBlocks(message?.content) + ROLE_OVERHEAD;
}
function estimateSystem(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD;
}
function estimateToolSchema(tool) {
  return Math.ceil(JSON.stringify(tool).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
}
function firstText(blocks) {
  if (!Array.isArray(blocks)) return "";
  for (const b of blocks) {
    if (b && b.type === "text" && typeof b.text === "string" && b.text.trim() !== "") {
      return b.text.replace(/\s+/g, " ").trim().slice(0, 80);
    }
  }
  return "";
}
function toolCallNames(blocks) {
  const names = [];
  if (!Array.isArray(blocks)) return names;
  for (const b of blocks) {
    if (b && b.type === "tool-call" && typeof b.name === "string") names.push(b.name);
  }
  return names;
}
function isInjection(source) {
  return source !== null && typeof source === "object" && (source.kind === "plugin" || source.kind === "skill-invocation" || typeof source.form === "string");
}

// src/host/fold.ts
var MAX_REQUEST_STEPS = 1500;
var MAX_KEPT_TURNS = 300;
var MAX_EVENTS = 400;
var MAX_NODES = 200;
function trimToLastTurns(requests, maxTurns) {
  let runs = 0;
  let start = requests.length;
  let prevTurn;
  for (let i = requests.length - 1; i >= 0; i--) {
    const turn = requests[i].turn;
    if (turn !== prevTurn) {
      if (runs >= maxTurns) break;
      runs++;
      prevTurn = turn;
    }
    start = i;
  }
  return requests.slice(start);
}
function countTurnRuns(requests) {
  let runs = 0;
  let prevTurn;
  for (const r of requests) {
    if (r.turn !== prevTurn) {
      runs++;
      prevTurn = r.turn;
    }
  }
  return runs;
}
function trimState(st) {
  if (countTurnRuns(st.requests) > MAX_KEPT_TURNS) {
    st.requests = trimToLastTurns(st.requests, MAX_KEPT_TURNS);
  }
  if (st.requests.length > MAX_REQUEST_STEPS) {
    st.requests = st.requests.slice(-MAX_REQUEST_STEPS);
  }
  if (st.events.length > MAX_EVENTS) st.events = st.events.slice(-MAX_EVENTS);
}
function createTimelineState() {
  return {
    surface: [],
    sums: { user: 0, inject: 0, assistant: 0, tool: 0 },
    systemTokens: 0,
    toolsTokens: 0,
    toolList: [],
    model: void 0,
    provider: void 0,
    lastModel: void 0,
    contextWindow: void 0,
    pressureTokens: void 0,
    sampledSurfaceTokens: void 0,
    occupancyWindow: void 0,
    requests: [],
    events: [],
    callNames: {}
  };
}
function categoryOf(type, message) {
  if (type === "assistant/message") return "assistant";
  if (type === "tool/result") return "tool";
  if (isInjection(message?.source)) return "inject";
  return "user";
}
function applySurface(st, ev, type, data, message) {
  const cat = categoryOf(type, message);
  const node = {
    seq: ev.seq,
    time: ev.time,
    cat,
    // Empty assistant messages project to no model message (usage-only), so
    // they price 0 — mirroring dsh's deriveEventMessage/estimate.
    tokens: estimateMessage(message, type === "assistant/message")
  };
  const source = message?.source;
  const form = source?.form;
  if (typeof form === "string") node.form = form;
  if (type === "assistant/message") {
    const text = firstText(message?.content);
    if (text !== "") node.text = text;
    else {
      const names = toolCallNames(message?.content);
      if (names.length > 0) node.calls = names.slice(0, 3);
    }
  } else if (type === "tool/result") {
    const srcId = source?.callId;
    const srcName = typeof srcId === "string" ? st.callNames[srcId] : void 0;
    const block = message?.content?.[0];
    const blockId = block?.toolCallId;
    if (srcName) node.tool = srcName;
    else if (typeof blockId === "string") node.tool = st.callNames[blockId];
    if (data?.error) node.err = true;
  } else if (source?.kind === "skill-invocation") {
    node.skill = typeof source.name === "string" ? source.name : "?";
  } else if (source?.kind === "plugin") {
    if (source.form === "notice" && typeof source.summary === "string") node.text = source.summary;
    else if (source.form === "snapshot" && Array.isArray(source.sections)) {
      node.text = source.sections.map((s) => s?.name).filter(Boolean).join(", ").slice(0, 80);
    } else {
      const ptext = firstText(message?.content);
      if (ptext !== "") node.text = ptext;
    }
  } else {
    const utext = firstText(message?.content);
    if (utext !== "") node.text = utext;
  }
  const shadowedSeqs = st.pendingShadowedSeqs;
  st.pendingShadowedSeqs = void 0;
  const op = ev.surfaceOp;
  if (op !== null && typeof op === "object" && op.op === "replace") {
    if (Array.isArray(shadowedSeqs) && shadowedSeqs.length > 0) {
      const shadowed = new Set(shadowedSeqs);
      const kept = [];
      for (const n of st.surface) {
        if (shadowed.has(n.seq)) st.sums[n.cat] -= n.tokens;
        else kept.push(n);
      }
      st.surface = kept;
      st.sums[cat] += node.tokens;
      st.surface.push(node);
      return node;
    }
    let si = -1;
    let ei = -1;
    for (let i = 0; i < st.surface.length; i++) {
      if (si < 0 && st.surface[i].seq === op.start) si = i;
      if (st.surface[i].seq === op.end) {
        ei = i;
        break;
      }
    }
    if (si >= 0 && ei >= si) {
      const removed = st.surface.splice(si, ei - si + 1, node);
      for (const r of removed) st.sums[r.cat] -= r.tokens;
      st.sums[cat] += node.tokens;
      return node;
    }
  }
  st.surface.push(node);
  st.sums[cat] += node.tokens;
  return node;
}
function pressureOf(usage) {
  if (usage === void 0 || typeof usage.inputTokens !== "number") return void 0;
  return usage.inputTokens + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
}
function sampleUsage(st, usage) {
  const pressureTokens = pressureOf(usage);
  if (pressureTokens === void 0) return;
  st.pressureTokens = pressureTokens;
  st.sampledSurfaceTokens = st.sums.user + st.sums.inject + st.sums.assistant + st.sums.tool;
}
function applyTimeline(state, event) {
  let st;
  const ensure = () => st ??= {
    ...state,
    surface: [...state.surface],
    sums: { ...state.sums },
    toolList: [...state.toolList],
    requests: [...state.requests],
    events: [...state.events],
    callNames: { ...state.callNames }
  };
  const data = event.data;
  switch (event.type) {
    case "request/header": {
      const header = data?.header ?? {};
      const tools = Array.isArray(header.tools) ? header.tools : [];
      const s = ensure();
      s.toolList = tools.map((t) => ({
        name: typeof t.name === "string" ? t.name : "?",
        tokens: estimateToolSchema(t)
      }));
      s.toolsTokens = estimateToolsTotal(tools);
      s.systemTokens = estimateSystem(header.system);
      if (header.config && typeof header.config.model === "string") s.model = header.config.model;
      if (header.config && typeof header.config.provider === "string") s.provider = header.config.provider;
      if (data?.reason === "change" && s.model && s.lastModel && s.model !== s.lastModel) {
        s.events.push({ seq: event.seq, time: event.time, kind: "model", from: s.lastModel, to: s.model });
      }
      if (s.model) s.lastModel = s.model;
      break;
    }
    case "request/context": {
      const s = ensure();
      if (data && typeof data.contextWindow === "number") s.contextWindow = data.contextWindow;
      if (data && typeof data.model === "string") s.model = data.model;
      if (data && typeof data.provider === "string") s.provider = data.provider;
      s.occupancyWindow = data && typeof data.contextWindow === "number" ? data.contextWindow : void 0;
      break;
    }
    case "tool/call": {
      if (data && data.callId !== void 0 && typeof data.name === "string") {
        const s = ensure();
        s.callNames[String(data.callId)] = data.name;
      }
      break;
    }
    case "user/message": {
      const msg = data;
      const s = ensure();
      const node = applySurface(s, event, event.type, data, msg);
      const source = msg?.source;
      if (isInjection(source)) {
        const rec = {
          seq: event.seq,
          time: event.time,
          kind: "inject",
          form: source.form || "context",
          tokens: node.tokens
        };
        if (source.kind === "skill-invocation") {
          rec.sub = "skill";
          rec.name = typeof source.name === "string" ? source.name : "?";
        } else if (typeof source.plugin === "string" && source.plugin !== "") {
          rec.name = source.plugin;
        }
        s.events.push(rec);
      }
      break;
    }
    case "tool/result": {
      const toolMsg = data?.message ?? null;
      const s = ensure();
      applySurface(s, event, event.type, data, toolMsg);
      break;
    }
    case "assistant/chunk": {
      const chunk = data?.chunk;
      if (chunk !== void 0 && chunk.type === "usage") {
        const s = ensure();
        sampleUsage(s, chunk.usage);
      }
      break;
    }
    case "assistant/message": {
      const usage = data?.usage;
      const s = ensure();
      sampleUsage(s, usage);
      const total = s.systemTokens + s.toolsTokens + s.sums.user + s.sums.inject + s.sums.assistant + s.sums.tool;
      const record = {
        turn: data && typeof data.turn === "number" ? data.turn : void 0,
        step: data && typeof data.step === "number" ? data.step : void 0,
        time: event.time,
        seq: event.seq,
        system: s.systemTokens,
        tools: s.toolsTokens,
        user: s.sums.user,
        inject: s.sums.inject,
        assistant: s.sums.assistant,
        tool: s.sums.tool,
        total
      };
      if (usage && typeof usage.inputTokens === "number") {
        record.prompt = usage.inputTokens + (usage.cacheReadTokens || 0) + (usage.cacheWriteTokens || 0);
        if (typeof usage.outputTokens === "number") record.output = usage.outputTokens;
      }
      s.requests.push(record);
      const asstMsg = data?.message ?? null;
      applySurface(s, event, event.type, data, asstMsg);
      break;
    }
    case "compaction/summary":
    case "compaction/prune": {
      const s = ensure();
      if (data && Array.isArray(data.shadowedSeqs)) {
        s.pendingShadowedSeqs = data.shadowedSeqs.filter((x) => typeof x === "number");
      }
      s.events.push({
        seq: event.seq,
        time: event.time,
        kind: event.type === "compaction/summary" ? "compaction" : "prune",
        tokens: data && typeof data.shadowedTokenCount === "number" ? data.shadowedTokenCount : 0,
        ...event.type === "compaction/summary" && data && Array.isArray(data.shadowedSeqs) ? { count: data.shadowedSeqs.length } : {}
      });
      break;
    }
    default:
      return state;
  }
  if (st !== void 0) {
    trimState(st);
    return st;
  }
  return state;
}
function buildTimelineView(state) {
  const surfaceTotal = state.sums.user + state.sums.inject + state.sums.assistant + state.sums.tool;
  const projectedTokens = state.pressureTokens !== void 0 && state.sampledSurfaceTokens !== void 0 ? Math.max(0, state.pressureTokens + surfaceTotal - state.sampledSurfaceTokens) : void 0;
  const result = {
    ok: true,
    model: state.model,
    provider: state.provider,
    contextWindow: state.contextWindow,
    current: {
      system: state.systemTokens,
      tools: state.toolsTokens,
      user: state.sums.user,
      inject: state.sums.inject,
      assistant: state.sums.assistant,
      tool: state.sums.tool,
      total: surfaceTotal + state.systemTokens + state.toolsTokens
    },
    occupancy: {
      ...state.pressureTokens === void 0 ? {} : { pressureTokens: state.pressureTokens },
      surfaceTokens: surfaceTotal,
      ...state.sampledSurfaceTokens === void 0 ? {} : { sampledSurfaceTokens: state.sampledSurfaceTokens },
      ...projectedTokens === void 0 ? {} : { projectedTokens },
      ...state.occupancyWindow === void 0 ? {} : { contextWindow: state.occupancyWindow }
    },
    toolList: state.toolList,
    requests: state.requests.map((r) => ({ ...r })),
    events: state.events.map((e) => ({ ...e })),
    nodes: [],
    droppedNodes: 0
  };
  result.droppedNodes = Math.max(0, state.surface.length - MAX_NODES);
  result.nodes = state.surface.slice(-MAX_NODES);
  const requests = result.requests;
  const events = result.events;
  let ri = 0;
  for (const ev of events) {
    while (ri < requests.length && requests[ri].seq <= ev.seq) ri++;
    const next = requests[ri];
    const prev = ri > 0 ? requests[ri - 1] : void 0;
    if (next !== void 0 && typeof next.turn === "number" && typeof next.step === "number") {
      ev.turn = next.turn;
      ev.step = next.step;
    }
    if (prev !== void 0 && typeof prev.turn === "number" && typeof prev.step === "number") {
      ev.fromTurn = prev.turn;
      ev.fromStep = prev.step;
    }
  }
  return result;
}

// src/host/timeline.ts
var surfaceNodeSchema = z.object({
  seq: z.number().int().nonnegative(),
  time: z.number().optional(),
  cat: z.enum(["user", "inject", "assistant", "tool"]),
  tokens: z.number().int().nonnegative(),
  form: z.string().optional(),
  text: z.string().optional(),
  tool: z.string().optional(),
  err: z.boolean().optional(),
  skill: z.string().optional(),
  calls: z.array(z.string()).optional()
}).strict();
var requestRecordSchema = z.object({
  turn: z.number().optional(),
  step: z.number().optional(),
  time: z.number(),
  seq: z.number(),
  system: z.number().int().nonnegative(),
  tools: z.number().int().nonnegative(),
  user: z.number().int().nonnegative(),
  inject: z.number().int().nonnegative(),
  assistant: z.number().int().nonnegative(),
  tool: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  prompt: z.number().int().nonnegative().optional(),
  output: z.number().int().nonnegative().optional(),
  stepCount: z.number().int().positive().optional()
}).strict();
var contextEventSchema = z.object({
  seq: z.number(),
  time: z.number(),
  kind: z.enum(["compaction", "prune", "inject", "model"]),
  form: z.string().optional(),
  tokens: z.number().optional(),
  count: z.number().optional(),
  sub: z.string().optional(),
  name: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  fromTurn: z.number().optional(),
  fromStep: z.number().optional(),
  turn: z.number().optional(),
  step: z.number().optional()
}).strict();
var currentSchema = z.object({
  system: z.number().int().nonnegative(),
  tools: z.number().int().nonnegative(),
  user: z.number().int().nonnegative(),
  inject: z.number().int().nonnegative(),
  assistant: z.number().int().nonnegative(),
  tool: z.number().int().nonnegative(),
  total: z.number().int().nonnegative()
}).strict();
var occupancySchema = z.object({
  pressureTokens: z.number().int().nonnegative().optional(),
  surfaceTokens: z.number().int().nonnegative(),
  sampledSurfaceTokens: z.number().int().nonnegative().optional(),
  projectedTokens: z.number().int().nonnegative().optional(),
  contextWindow: z.number().int().positive().optional()
}).strict();
var contextTimelineSchema = z.object({
  ok: z.literal(true),
  model: z.string().optional(),
  provider: z.string().optional(),
  contextWindow: z.number().optional(),
  current: currentSchema,
  occupancy: occupancySchema.optional(),
  toolList: z.array(z.object({ name: z.string(), tokens: z.number().int().nonnegative() }).strict()),
  requests: z.array(requestRecordSchema),
  events: z.array(contextEventSchema),
  nodes: z.array(surfaceNodeSchema),
  droppedNodes: z.number().int().nonnegative()
}).strict();
var contextTimelineDefinition = {
  key: "contextTimeline",
  schema: contextTimelineSchema,
  init: () => createTimelineState(),
  apply: (state, event) => applyTimeline(state, event),
  view: (state) => buildTimelineView(state),
  stateVersion: 1
};

// src/host/index.ts
var name = "dsh-context";
var inject = ["sessionProjections"];
function apply(ctx) {
  ctx.inject(["sessionProjections"], (projectionCtx) => {
    projectionCtx.sessionProjections.register(contextTimelineDefinition);
  });
}
export {
  apply,
  inject,
  name
};
