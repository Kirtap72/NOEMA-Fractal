// MCP-02: a small, stateless tool-calling loop over OpenAI-compatible Chat Completions (used for Ollama Cloud, which does not offer the
// Responses API). It does what the Agents SDK run does for the OpenAI provider and returns the same result shape, so the chat engine,
// budgets, GPU gate, events and tests are shared:
//   model call -> tool calls executed through the EXISTING stdio MCP shim -> results (and pictures) back to the model -> repeat.
// Tool results cannot carry pictures in Chat Completions, so a picture comes back as a following user message with an image_url part.
import { MCPServerStdio } from '@openai/agents';
import { PREVIEW_TOOLS, TOOL_DESCRIPTION_MAX, compactOldResults, dropOldImages, requestSizes } from './agentCore.mjs';
import { redact } from './run-agent.mjs';

const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
const wait = (ms, signal) => new Promise((resolve, reject) => { const t = setTimeout(resolve, ms); signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Avbrutet.')); }, { once: true }); });

/** One request with a few polite retries for rate limits and temporary server errors. The key only ever goes in the header. */
export async function chatRequest({ baseURL, apiKey, body, signal, fetchImpl = fetch, retries = 2, timeoutMs = 120_000 }) {
  for (let attempt = 0; ; attempt++) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const onAbort = () => timeout.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetchImpl(baseURL + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` }, body: JSON.stringify(body), signal: timeout.signal });
      if (res.ok) return await res.json();
      const text = await res.text().catch(() => '');
      if ((res.status === 429 || res.status >= 500) && attempt < retries) { await wait(1500 * (attempt + 1), signal); continue; }
      const hint = res.status === 401 || res.status === 403 ? ' (kontrollera nyckeln)' : res.status === 404 ? ' (the model does not exist at the provider)' : res.status === 429 ? ' (too many calls or out of credit)' : '';
      throw Object.assign(new Error(`The provider answered ${res.status}${hint}: ${clip(text.replace(/\s+/g, ' '), 160)}`), { code: 'http_' + res.status });
    } catch (e) {
      if (signal?.aborted) throw Object.assign(new Error('Avbrutet.'), { code: 'cancelled' });
      if (timeout.signal.aborted) throw Object.assign(new Error('The provider did not answer in time.'), { code: 'timeout' });
      throw e;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
  }
}

const toToolDefs = (tools) => tools.map((t) => ({ type: 'function', function: { name: t.name, description: clip(String(t.description ?? ''), TOOL_DESCRIPTION_MAX), parameters: t.inputSchema ?? { type: 'object', properties: {} } } }));
const parseArgs = (s) => { if (typeof s !== 'string') return s ?? {}; try { return s.trim() ? JSON.parse(s) : {}; } catch { return null; } };

export async function runChatCompletionsTurn({
  baseURL, apiKey, model, instructions, input, history = [], shim, budget, gpuBusy = async () => false, signal, onEvent = () => {},
  maxTurns = 40, keepImages = 2, fetchImpl = fetch, temperature, userImages = [], pins = [],
}) {
  const emit = (e) => { try { onEvent(e); } catch { /* listener errors never break the run */ } };
  const calls = [], images = [], usage = { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedTokens: 0, peakPromptTokens: 0 };
  // Reference pictures go as OpenAI-compatible image_url parts holding a base64 data URL (the form Ollama Cloud accepts).
  const userMessage = userImages.length
    ? { role: 'user', content: [{ type: 'text', text: String(input) }, ...userImages.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}` } }))] }
    : { role: 'user', content: String(input) };
  const messages = [...history, userMessage];
  let status = 'done', finalOutput, gpuNow = false;

  const server = new MCPServerStdio({ name: 'noema-fractal', command: shim.command, args: shim.args, env: shim.env, cacheToolsList: false, clientSessionTimeoutSeconds: 240 });
  await server.connect();
  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal?.aborted) { status = 'cancelled'; break; }
      const exhausted = budget.exhausted();
      let tools = [];
      if (!exhausted) {
        tools = (await server.listTools()).filter((t) => budget.toolVisible(t.name));
        gpuNow = false;
        if (tools.some((t) => PREVIEW_TOOLS.has(t.name))) gpuNow = !!(await Promise.resolve(gpuBusy()).catch(() => false));
        tools = tools.filter((t) => !PREVIEW_TOOLS.has(t.name) || (!gpuNow && budget.previewsLeft() >= (t.name === 'noema_compare_renders' ? 2 : 1)));
      }
      // Older tool answers are shortened and older pictures dropped before every request: each request resends the whole conversation.
      const body = { model, messages: [{ role: 'system', content: instructions }, ...compactOldResults(dropOldImages(messages, keepImages, pins))], stream: false, ...(temperature !== undefined ? { temperature } : {}) };
      if (tools.length) { body.tools = toToolDefs(tools); body.tool_choice = 'auto'; }
      const sizes = requestSizes(body.messages, body.tools);
      let resp;
      try { resp = await chatRequest({ baseURL, apiKey, body, signal, fetchImpl }); }
      catch (e) { status = e.code === 'cancelled' ? 'cancelled' : 'error'; if (status === 'error') emit({ type: 'error', message: String(e.message).replace(/sk-[A-Za-z0-9_-]{8,}/g, '***').slice(0, 300) }); break; }
      usage.requests++;
      const prompt = resp.usage?.prompt_tokens ?? 0, completion = resp.usage?.completion_tokens ?? 0, cached = resp.usage?.prompt_tokens_details?.cached_tokens ?? 0;
      usage.inputTokens += prompt; usage.outputTokens += completion; usage.cachedTokens += cached; usage.peakPromptTokens = Math.max(usage.peakPromptTokens, prompt);
      budget.inputTokens = usage.inputTokens; budget.outputTokens = usage.outputTokens; budget.notePrompt(prompt);
      // Provider-reported numbers (prompt/completion/cached) next to LOCAL size estimates of the same request, so the two are never confused.
      emit({ type: 'usage', request: usage.requests, reported: { promptTokens: prompt, completionTokens: completion, cachedTokens: cached }, local: sizes });
      const msg = resp.choices?.[0]?.message;
      if (!msg) { status = 'error'; emit({ type: 'error', message: 'The provider gave no answer.' }); break; }
      const text = typeof msg.content === 'string' ? msg.content : '';
      const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      messages.push({ role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      if (text) emit({ type: 'text', text });
      if (!toolCalls.length) { finalOutput = text; break; }

      const pictures = [];
      for (const tc of toolCalls) {
        const name = tc.function?.name ?? '', args = parseArgs(tc.function?.arguments);
        const entry = { n: calls.length + 1, name, args: args ?? {}, callId: tc.id };
        calls.push(entry); budget.addCall(name);
        emit({ type: 'tool_call', n: entry.n, name, args: redact(entry.args), budget: budget.snapshot() });
        let content;
        if (args === null) content = 'Error: the arguments were not valid JSON. Send the call again.';
        else if (budget.toolCalls > budget.limits.toolCalls) content = 'The budget for tool calls is used up. Finish with a short summary.';
        else {
          try {
            const result = await server.callTool(name, args, null, { signal });
            const parts = Array.isArray(result) ? result : [];
            content = parts.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') || '(empty answer)';
            for (const c of parts) if (c?.type === 'image' && typeof c.data === 'string') pictures.push({ mime: c.mimeType || 'image/png', base64: c.data, n: entry.n, tool: name });
          } catch (e) { content = 'Verktygsfel: ' + clip(String(e?.message ?? e), 300); }
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content });
        const mine = pictures.filter((p) => p.n === entry.n);
        for (const img of mine) { images.push({ mime: img.mime, base64: img.base64, forCall: entry.n }); emit({ type: 'image', base64: img.base64, mime: img.mime, forCall: entry.n, tool: name }); }
        emit({ type: 'tool_result', n: entry.n, name, output: redact(content), images: mine.length });
      }
      if (pictures.length) {
        messages.push({ role: 'user', content: [{ type: 'text', text: 'Picture from the tool (look at it and describe what you actually see):' }, ...pictures.map((p) => ({ type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.base64}` } }))] });
      }
      if (signal?.aborted) { status = 'cancelled'; break; }
      if (turn === maxTurns - 1) status = 'budget:toolCalls';
    }
  } finally { await server.close().catch(() => {}); }

  usage.totalTokens = usage.inputTokens + usage.outputTokens;
  const left = budget.exhausted();
  if (status === 'done' && left) status = `budget:${left}`;
  emit({ type: 'budget', ...budget.snapshot(), status });
  return { status, finalOutput, history: compactOldResults(messages, 6), usage, calls, images, budget: budget.snapshot(), gpuBusySeen: gpuNow };
}
