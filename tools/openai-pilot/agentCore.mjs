// MCP-02: the model loop shared by the terminal session and the in-app chat.
// - one bounded run of an OpenAI Agents SDK agent against NOEMA through the EXISTING stdio shim
// - configurable budgets (tool calls, previews, seconds, API cost, tokens) that END the run gracefully instead of looping on
// - a soft GPU gate: when the card is busy with something else the preview tools simply disappear from the model's list for that turn.
//   Nothing here ever terminates an application, and a waiting app is never wrapped in a VRAM guard.
// - old pictures are dropped from what is sent back to the model (only the newest few stay), which is most of the token saving
// The API key is read from the environment by the SDK; it is never printed, written or handed to the shim.
import { Agent, MCPServerStdio, run, setTracingDisabled } from '@openai/agents';
import { collectImages, redact, uniqueImages } from './run-agent.mjs';

setTracingDisabled(true);

/** US dollars per million tokens (list price, standard tier; cache discounts are not counted, so the estimate errs on the high side). */
export const PRICES = { 'gpt-5.4-mini': { input: 0.75, output: 4.5 } };
export const DEFAULT_PRICE = { input: 0.75, output: 4.5 };
export const PREVIEW_TOOLS = new Set(['noema_render_preview', 'noema_compare_renders']);
/** Tools that only read. They never change a draft, so a mode that must not change anything (Teach me) may always use them. */
export const READ_TOOLS = new Set(['noema_get_capabilities', 'noema_list_formulas', 'noema_explain_setting', 'noema_search_help', 'noema_search_knowledge', 'noema_get_knowledge', 'noema_check_chain', 'noema_inspect_scene', 'noema_list_materials', 'noema_list_artworks', 'noema_list_drafts']);
/** Tools that create or change a draft (never the live scene; that needs the artist's own button). */
export const MUTATING_TOOLS = new Set(['noema_create_draft', 'noema_set_draft_parameters', 'noema_apply_material_to_draft', 'noema_set_draft_camera', 'noema_set_draft_light', 'noema_set_draft_ambient', 'noema_undo_draft_step', 'noema_discard_draft', 'noema_request_apply_draft', 'noema_record_experiment']);

/** Tool descriptions are sent with EVERY request; the full text stays in the manual and noema_get_capabilities. */
export const TOOL_DESCRIPTION_MAX = 600;
export const DEFAULT_BUDGET = { toolCalls: 40, previews: 10, seconds: 300, costUSD: 0.25, tokens: 400_000 };
export const HARD_MAX_BUDGET = { toolCalls: 150, previews: 30, seconds: 1800, costUSD: 3, tokens: 3_000_000 };

/** Reads budget settings from untrusted input (the chat panel): anything invalid falls back to the default, nothing exceeds the hard maximum. */
export function normalizeBudget(input = {}) {
  const out = {};
  for (const key of Object.keys(DEFAULT_BUDGET)) {
    const v = input?.[key];
    out[key] = typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, HARD_MAX_BUDGET[key]) : DEFAULT_BUDGET[key];
  }
  return out;
}

export class Budget {
  constructor(limits = DEFAULT_BUDGET, price = DEFAULT_PRICE, now = () => Date.now()) {
    this.limits = normalizeBudget(limits); this.price = price; this.now = now; this.startedAt = now();
    this.toolCalls = 0; this.previews = 0; this.inputTokens = 0; this.outputTokens = 0; this.mutations = 0;
    /** null = every tool; otherwise only these (a hard rule of the mode, not a request to the model). */
    this.allow = null; this.maxMutations = Infinity;
  }
  /** Is this tool offered to the model right now? Combines the mode's allow-list and the cap on draft changes per turn. */
  toolVisible(name) {
    if (this.allow && !this.allow.has(name)) return false;
    if (MUTATING_TOOLS.has(name) && this.mutations >= this.maxMutations) return false;
    return true;
  }
  get seconds() { return (this.now() - this.startedAt) / 1000; }
  get tokens() { return this.inputTokens + this.outputTokens; }
  get costUSD() { return (this.inputTokens * this.price.input + this.outputTokens * this.price.output) / 1_000_000; }
  addCall(name) { this.toolCalls++; if (MUTATING_TOOLS.has(name)) this.mutations++; if (name === 'noema_render_preview') this.previews++; else if (name === 'noema_compare_renders') this.previews += 2; }
  addUsage(u = {}) { this.inputTokens += u.inputTokens ?? 0; this.outputTokens += u.outputTokens ?? 0; }
  /** The largest prompt of any single request: how big the conversation really got (the cumulative sum counts it again every request). */
  notePrompt(tokens) { this.peakPrompt = Math.max(this.peakPrompt ?? 0, tokens ?? 0); }
  /** Which budget has run out, or null. Reaching a limit stops NEW tool calls; the run then ends with the model's text. */
  exhausted() {
    const l = this.limits;
    if (this.toolCalls >= l.toolCalls) return 'toolCalls';
    if (this.seconds >= l.seconds) return 'seconds';
    if (this.costUSD >= l.costUSD) return 'costUSD';
    if (this.tokens >= l.tokens) return 'tokens';
    return null;
  }
  previewsLeft() { return Math.max(0, this.limits.previews - this.previews); }
  snapshot() { return { toolCalls: this.toolCalls, previews: this.previews, seconds: Math.round(this.seconds), tokens: this.tokens, peakPrompt: this.peakPrompt ?? 0, costUSD: Math.round(this.costUSD * 10000) / 10000, limits: this.limits }; }
}

/** Keeps the newest `keep` pictures in a list of input items and replaces older ones with a short note (fewer tokens, same story). */
export function dropOldImages(items, keep = 1, pins = []) {
  const nodes = [];
  // A reference image the artist chose stays in view for the whole session (it is the point of the conversation); previews age out.
  const isPinned = (n) => pins.length > 0 && pins.some((p) => JSON.stringify(n).includes(p));
  const visit = (v) => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!v || typeof v !== 'object') return;
    if (v.type === 'input_image' || v.type === 'image' || v.type === 'image_url') { if (!isPinned(v)) nodes.push(v); return; }
    Object.values(v).forEach(visit);
  };
  visit(items);
  const old = new Set(nodes.slice(0, Math.max(0, nodes.length - keep)));
  const note = 'earlier picture omitted to save cost';
  const rewrite = (v) => {
    if (Array.isArray(v)) return v.map(rewrite);
    if (!v || typeof v !== 'object') return v;
    if (old.has(v)) return v.type === 'input_image' ? { type: 'input_text', text: `[${note}]` } : { type: 'text', text: `[${note}]` };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x)]));
  };
  return rewrite(items);
}

/**
 * FORMULA-EXPLORATION-01: keeps only the newest `keepRecent` tool results in full and shortens older ones to their first `maxChars`
 * characters. Every model request resends the whole conversation, so long tool answers (formula lists, scene summaries) were paid for
 * again on every later request; the model has already acted on them and the draft itself holds the state. Handles Chat Completions
 * (`role: 'tool'`) and Responses (`type: 'function_call_output'`) items. Returns new items; the input is not changed.
 */
export function compactOldResults(items, keepRecent = 6, maxChars = 260) {
  const isResult = (it) => it && typeof it === 'object' && (it.role === 'tool' || it.type === 'function_call_output');
  const total = items.filter(isResult).length;
  let seen = 0;
  const short = (s) => (s.length > maxChars ? s.slice(0, maxChars) + ' …[older answer shortened]' : s);
  return items.map((it) => {
    if (!isResult(it)) return it;
    seen++;
    if (total - seen < keepRecent) return it;
    if (it.role === 'tool') return typeof it.content === 'string' ? { ...it, content: short(it.content) } : it;
    const out = it.output;
    if (typeof out === 'string') return { ...it, output: short(out) };
    if (out && typeof out === 'object' && typeof out.text === 'string') return { ...it, output: { ...out, text: short(out.text) } };
    return it;
  });
}

/** Local size estimate of one model request, split into what is resent every time: tool definitions, text history and picture data. */
export function requestSizes(messages, toolDefs = []) {
  let imageChars = 0, historyChars = 0;
  const walk = (v) => {
    if (typeof v === 'string') { historyChars += v.length; return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.url === 'string' && v.url.startsWith('data:')) { imageChars += v.url.length; return; }
    if (typeof v.image === 'string' && v.image.startsWith('data:')) { imageChars += v.image.length; return; }
    Object.values(v).forEach(walk);
  };
  walk(messages);
  return { schemaChars: JSON.stringify(toolDefs).length, historyChars, imageChars, approxTextTokens: Math.round((JSON.stringify(toolDefs).length + historyChars) / 3.5) };
}

const SAFE_ENV = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'APPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT', 'WINDIR'];
/** What the MCP shim process gets: Node's basics, the endpoint file, optionally ELECTRON_RUN_AS_NODE. Never the API key. */
/** Short fingerprints of reference pictures, used to keep them from being dropped. */
export const pinsOf = (images = []) => images.filter((i) => i?.base64?.length > 400).map((i) => i.base64.slice(200, 264));

export function shimEnv(endpointFile, { electronAsNode = false, source = process.env } = {}) {
  const env = {};
  for (const k of SAFE_ENV) if (source[k] !== undefined) env[k] = source[k];
  env.NOEMA_AI_ENDPOINT = endpointFile;
  if (electronAsNode) env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

const parseMaybe = (s) => { try { return JSON.parse(s); } catch { return s; } };
const textOf = (content) => (Array.isArray(content) ? content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('') : typeof content === 'string' ? content : '');

/**
 * One turn of conversation: the user's input goes in, the model may call NOEMA's tools (within the budget), and the run ends with text.
 * Returns { status, finalOutput, history, usage, calls, images, budget }. status: 'done' | 'budget:<which>' | 'cancelled' | 'error'.
 */
export async function runAgentTurn({
  model, instructions, input, history = [], shim, budget = new Budget(), gpuBusy = async () => false, signal, onEvent = () => {},
  maxTurns = 40, keepImages = 2, userImages = [], pins = [], modelSettings = { parallelToolCalls: false, reasoning: { effort: 'low' } }, name = 'NOEMA art assistant',
}) {
  const calls = [], images = [];
  const emit = (e) => { try { onEvent(e); } catch { /* the listener must never break the run */ } };
  let stream;
  // Keeps the running token and cost count in step with what the API has really reported so far (so the cost budget bites mid-run).
  const syncUsage = () => {
    let i = 0, o = 0;
    for (const r of stream?.rawResponses ?? []) { i += r.usage?.inputTokens ?? 0; o += r.usage?.outputTokens ?? 0; }
    budget.inputTokens = Math.max(budget.inputTokens, i); budget.outputTokens = Math.max(budget.outputTokens, o);
  };
  let gpuNow = false;
  const server = new MCPServerStdio({
    name: 'noema-fractal', command: shim.command, args: shim.args, env: shim.env, cacheToolsList: false, clientSessionTimeoutSeconds: 240,
    // Evaluated before every model turn: a hard bound, not a request.
    toolFilter: async (_ctx, tool) => {
      if (budget.exhausted() || !budget.toolVisible(tool.name)) return false;
      if (PREVIEW_TOOLS.has(tool.name)) {
        if (budget.previewsLeft() < (tool.name === 'noema_compare_renders' ? 2 : 1)) return false;
        gpuNow = await Promise.resolve(gpuBusy()).catch(() => false);
        if (gpuNow) return false;
      }
      return true;
    },
  });
  const agent = new Agent({ name, instructions, model, mcpServers: [server], modelSettings });
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  let timer;
  let status = 'done';
  await server.connect();
  try {
    const hardStop = Math.max(5, budget.limits.seconds - budget.seconds + 30) * 1000; // the run may overrun by at most 30 s, then it is cut
    timer = setTimeout(() => { status = 'budget:seconds'; controller.abort(); }, hardStop);
    const userItem = userImages.length
      ? { role: 'user', content: [{ type: 'input_text', text: String(input) }, ...userImages.map((i) => ({ type: 'input_image', image: `data:${i.mime};base64,${i.base64}` }))] }
      : { role: 'user', content: String(input) };
    const items = [...history, userItem];
    stream = await run(agent, items, {
      stream: true, maxTurns, signal: controller.signal,
      callModelInputFilter: ({ modelData }) => ({ ...modelData, input: compactOldResults(dropOldImages(modelData.input, keepImages, pins)) }),
    });
    const pending = new Map();
    for await (const event of stream) {
      if (event.type !== 'run_item_stream_event') continue;
      const raw = event.item.rawItem ?? {};
      if (event.name === 'tool_called') {
        const entry = { n: calls.length + 1, name: raw.name, args: parseMaybe(raw.arguments), callId: raw.callId ?? raw.id };
        calls.push(entry); pending.set(entry.callId, entry); budget.addCall(entry.name); syncUsage();
        emit({ type: 'tool_call', n: entry.n, name: entry.name, args: redact(entry.args), budget: budget.snapshot() });
      } else if (event.name === 'tool_output') {
        const out = event.item.output ?? raw.output;
        const found = uniqueImages(collectImages(out).concat(collectImages(raw.output)));
        const entry = pending.get(raw.callId) ?? calls.at(-1) ?? {};
        for (const img of found) { images.push({ ...img, forCall: entry.n }); emit({ type: 'image', base64: img.base64, mime: img.mime, forCall: entry.n, tool: entry.name }); }
        emit({ type: 'tool_result', n: entry.n, name: entry.name, output: redact(out), images: found.length });
      } else if (event.name === 'message_output_created') {
        syncUsage();
        const text = textOf(raw.content);
        if (text) emit({ type: 'text', text });
      }
    }
    await stream.completed;
  } catch (e) {
    if (status === 'done') status = controller.signal.aborted ? (signal?.aborted ? 'cancelled' : 'cancelled') : 'error';
    if (status === 'error') { emit({ type: 'error', message: String(e?.message ?? e).replace(/sk-[A-Za-z0-9_-]{8,}/g, '***').slice(0, 300) }); }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    await server.close().catch(() => {});
  }
  const usage = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  for (const r of stream?.rawResponses ?? []) { const u = r.usage ?? {}; usage.requests++; usage.inputTokens += u.inputTokens ?? 0; usage.outputTokens += u.outputTokens ?? 0; usage.totalTokens += u.totalTokens ?? ((u.inputTokens ?? 0) + (u.outputTokens ?? 0)); }
  // Real usage replaces the running estimate (the estimate is only needed while the run is going).
  budget.inputTokens = usage.inputTokens; budget.outputTokens = usage.outputTokens;
  const exhausted = budget.exhausted();
  if (status === 'done' && exhausted) status = `budget:${exhausted}`;
  emit({ type: 'budget', ...budget.snapshot(), status });
  return { status, finalOutput: stream?.finalOutput, history: stream?.history ?? [], usage, calls, images, budget: budget.snapshot(), gpuBusySeen: gpuNow };
}
