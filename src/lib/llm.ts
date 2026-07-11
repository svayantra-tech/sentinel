// ─────────────────────────────────────────────────────────────────────────────
// Sentinel LLM client (FR-06/FR-10, NFR-04)
//
// Provider-agnostic OpenAI-compatible chat client:
//   · PRIMARY:  LLM_BASE_URL (Featherless — 40k+ open models) with
//     LLM_API_KEYS comma-separated round-robin rotation; a 429/5xx advances
//     to the next key automatically.
//   · FALLBACK: LLM_FALLBACK_BASE_URL (Groq / Gemini-compat / OpenAI).
//   · DEMO_MODE=scripted → deterministic generator (see docs/DEMO_SCRIPT.md):
//     reproducible fault-injection so the safety-gate demonstration is
//     identical on every run. Live mode uses real inference.
// Every call is recorded with GenAI semantic attributes + CRISPE prompt hash.
// ─────────────────────────────────────────────────────────────────────────────
import { recordLlmUsage, promptHash } from './telemetry';

export interface ChatResult {
  text: string;
  model: string;
  provider: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  fallbackUsed: boolean;
}

// Discriminated outcome so callers can report WHY a live call fell back
// (HTTP status / provider / model) instead of silently degrading to scripted.
export type ChatOutcome =
  | { ok: true; result: ChatResult }
  | { ok: false; reason: string; status: number | null; provider: string | null; model: string | null };

interface ProviderCfg { baseUrl: string; keys: string[]; model: string; name: string }

function providers(): ProviderCfg[] {
  const list: ProviderCfg[] = [];
  const p = process.env.LLM_BASE_URL?.trim();
  const pk = (process.env.LLM_API_KEYS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (p && pk.length) list.push({
    baseUrl: p, keys: pk, name: providerName(p),
    model: process.env.LLM_MODEL || 'meta-llama/Meta-Llama-3.1-70B-Instruct',
  });
  const f = process.env.LLM_FALLBACK_BASE_URL?.trim();
  const fk = (process.env.LLM_FALLBACK_API_KEYS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (f && fk.length) list.push({
    baseUrl: f, keys: fk, name: providerName(f),
    model: process.env.LLM_FALLBACK_MODEL || 'llama-3.3-70b-versatile',
  });
  return list;
}

function providerName(url: string): string {
  if (url.includes('featherless')) return 'featherless';
  if (url.includes('groq')) return 'groq';
  if (url.includes('googleapis') || url.includes('generativelanguage')) return 'gemini';
  if (url.includes('openai')) return 'openai';
  return 'openai-compatible';
}

// Round-robin cursor per provider (module scope — resets per process, fine).
const cursors = new Map<string, number>();
function nextKey(p: ProviderCfg): string {
  const c = cursors.get(p.baseUrl) ?? 0;
  cursors.set(p.baseUrl, (c + 1) % p.keys.length);
  return p.keys[c % p.keys.length];
}

export async function chat(opts: {
  system: string; user: string;
  correlationId: string; runId?: string; step: string;
  json?: boolean; temperature?: number; maxTokens?: number;
}): Promise<ChatOutcome> {
  const started = Date.now();
  const hash = promptHash(opts.system);
  const provs = providers();
  if (!provs.length) {
    return { ok: false, reason: 'no LLM provider configured (empty LLM_API_KEYS)', status: null, provider: null, model: null };
  }

  // Track the last failure so the caller can report WHY it fell back.
  let lastStatus: number | null = null;
  let lastProvider: string | null = null;
  let lastModel: string | null = null;
  let lastReason = 'no response';

  for (let pi = 0; pi < provs.length; pi++) {
    const p = provs[pi];
    lastProvider = p.name; lastModel = p.model;
    // Try every key on this provider before falling through.
    for (let attempt = 0; attempt < p.keys.length; attempt++) {
      const key = nextKey(p);
      try {
        const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: p.model,
            temperature: opts.temperature ?? 0.2,
            max_tokens: opts.maxTokens ?? 1400,
            ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
            messages: [
              { role: 'system', content: opts.system },
              { role: 'user', content: opts.user },
            ],
          }),
          signal: AbortSignal.timeout(45_000),
        });
        if (res.status === 429 || res.status >= 500) { lastStatus = res.status; lastReason = `HTTP ${res.status}`; continue; } // rotate key
        if (!res.ok) { lastStatus = res.status; lastReason = `HTTP ${res.status}`; continue; }
        const data = (await res.json()) as {
          choices: Array<{ message: { content: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          model?: string;
        };
        const text = data.choices?.[0]?.message?.content ?? '';
        if (!text) { lastReason = 'empty response body'; continue; }
        const result: ChatResult = {
          text,
          model: data.model || p.model,
          provider: p.name,
          tokensIn: data.usage?.prompt_tokens ?? Math.round((opts.system.length + opts.user.length) / 4),
          tokensOut: data.usage?.completion_tokens ?? Math.round(text.length / 4),
          latencyMs: Date.now() - started,
          fallbackUsed: pi > 0,
        };
        recordLlmUsage({
          correlationId: opts.correlationId, runId: opts.runId, step: opts.step,
          model: result.model, provider: result.provider, latencyMs: result.latencyMs,
          tokensIn: result.tokensIn, tokensOut: result.tokensOut,
          promptHash: hash, fallbackUsed: result.fallbackUsed,
        });
        return { ok: true, result };
      } catch (err) {
        lastReason = (err as Error)?.name === 'TimeoutError' ? 'timeout (45s)' : `network: ${String((err as Error)?.message ?? err).slice(0, 80)}`;
        continue; // network/timeout → next key
      }
    }
  }
  return { ok: false, reason: lastReason, status: lastStatus, provider: lastProvider, model: lastModel };
}

// ── Live-mode health banner (TASK 1.3) ───────────────────────────────────────
// When DEMO_MODE=live, ping the provider chain ONCE so the operator learns the
// LLM is unreachable BEFORE demoing — rather than silently running scripted.
let healthChecked = false;
function liveBanner(reason: string): string {
  const bar = '#'.repeat(78);
  return `\n${bar}\n####  LIVE MODE REQUESTED BUT LLM UNREACHABLE (${reason}) — RUNNING SCRIPTED  ####\n${bar}\n`;
}
export async function healthCheckLLM(): Promise<void> {
  if (healthChecked) return;
  healthChecked = true;
  if (demoMode() !== 'live') return;
  const provs = providers();
  if (!provs.length) { process.stderr.write(liveBanner('no LLM provider configured (empty LLM_API_KEYS)')); return; }
  let lastReason = 'unreachable';
  for (const p of provs) {
    try {
      const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${p.keys[0]}` },
        body: JSON.stringify({ model: p.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return; // a provider is reachable → healthy, no banner
      lastReason = `HTTP ${res.status}`;
    } catch (err) {
      lastReason = (err as Error)?.name === 'TimeoutError' ? 'timeout' : `unreachable: ${String((err as Error)?.message ?? err).slice(0, 60)}`;
    }
  }
  process.stderr.write(liveBanner(lastReason));
}

/** Strip code fences and extract the outermost JSON object safely. */
export function parseJsonLoose<T>(raw: string): T | null {
  try {
    let t = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/m, '').trim();
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) t = t.slice(s, e + 1);
    return JSON.parse(t) as T;
  } catch {
    return null;
  }
}

export function demoMode(): 'live' | 'scripted' {
  return process.env.DEMO_MODE === 'scripted' ? 'scripted' : 'live';
}
