// MCP-02: model providers. Nothing here is tied to one model or one company: a provider is a name, an endpoint, the environment variable
// that holds its key, and the kind of API it speaks. The key is read from the environment when needed and never stored in a project file.
//   openai : OpenAI Responses API through the Agents SDK (optional)
//   ollama : Ollama Cloud, OpenAI-compatible Chat Completions at https://ollama.com/v1. It supports only a subset of OpenAI's API
//            (no Responses API), so NOEMA uses its own stateless tool-calling loop (chatCompletionsLoop.mjs).
import { PRICES, DEFAULT_PRICE } from './agentCore.mjs';

export const PROVIDERS = {
  ollama: { id: 'ollama', label: 'Ollama Cloud', keyEnv: 'OLLAMA_API_KEY', baseURL: 'https://ollama.com/v1', showURL: 'https://ollama.com/api/show', api: 'chat-completions', publicModelList: true },
  openai: { id: 'openai', label: 'OpenAI', keyEnv: 'OPENAI_API_KEY', baseURL: 'https://api.openai.com/v1', api: 'responses', publicModelList: false },
};
export const PROVIDER_IDS = Object.keys(PROVIDERS);

/** Models to try first with Ollama Cloud (the artist's own choice; the list the server returns decides what is really offered). */
export const RECOMMENDED = {
  ollama: ['deepseek-v4.1-flash', 'glm-5.3-flash', 'minimax-m3.1-flash'],
  openai: ['gpt-5.4-mini'],
};
export const DEFAULT_PROVIDER = 'ollama';

export function providerOf(id) {
  const p = PROVIDERS[id];
  if (!p) throw Object.assign(new Error('Unknown provider.'), { code: 'unknown_provider' });
  return p;
}

export function apiKeyFor(provider, env = process.env) {
  const key = env[providerOf(provider).keyEnv];
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

/** Cost per million tokens. Ollama Cloud is billed by plan/credits, not per token, so its cost is unknown: only the token, time and call budgets apply. */
export function priceFor(provider, model) {
  if (provider === 'openai') return { ...(PRICES[model] ?? DEFAULT_PRICE), known: true };
  return { input: 0, output: 0, known: false };
}

const clean = (s) => String(s ?? '').replace(/[^\w.:\-/]/g, '').slice(0, 100);

/**
 * The models a provider offers, recommended ones first, each with what the server declares it can do (tools, vision).
 * `capabilities` comes from the provider's own declaration; it says nothing about how well a model actually uses the tools, which is
 * only known after a real run (see docs/ai-bridge/MCP-02-RAPPORT.md).
 */
export async function listModels(provider, { fetchImpl = fetch, env = process.env, withCapabilities = true, signal } = {}) {
  const p = providerOf(provider);
  const key = apiKeyFor(provider, env);
  if (!p.publicModelList && !key) return { provider, models: RECOMMENDED[provider].map((id) => ({ id, recommended: true })), source: 'default', note: `${p.keyEnv} is missing: only shows suggestions.` };
  const res = await fetchImpl(p.baseURL + '/models', { headers: key ? { authorization: `Bearer ${key}` } : {}, signal });
  if (!res.ok) throw Object.assign(new Error(`The model list could not be fetched (${res.status}).`), { code: 'models_failed' });
  const body = await res.json();
  let ids = (Array.isArray(body?.data) ? body.data : []).map((m) => clean(m?.id)).filter(Boolean);
  if (provider === 'openai') ids = ids.filter((id) => /^(gpt|o\d)/.test(id)).sort();
  const rec = RECOMMENDED[provider];
  ids = [...rec.filter((id) => ids.includes(id)), ...ids.filter((id) => !rec.includes(id)).sort()];
  const models = ids.map((id) => ({ id, recommended: rec.includes(id), available: true }));
  if (withCapabilities && p.showURL) {
    // Only the recommended models are looked up (a request each); the rest show "okänt" until chosen.
    await Promise.all(models.filter((m) => m.recommended).map(async (m) => {
      try {
        const r = await fetchImpl(p.showURL, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ model: m.id }), signal });
        if (r.ok) { const j = await r.json(); m.capabilities = Array.isArray(j?.capabilities) ? j.capabilities.map(String).slice(0, 12) : undefined; }
      } catch { /* the capability line is optional */ }
    }));
  }
  for (const id of rec) if (!models.some((m) => m.id === id)) models.unshift({ id, recommended: true, available: false });
  return { provider, models, source: 'server' };
}
