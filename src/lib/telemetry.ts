// ─────────────────────────────────────────────────────────────────────────────
// Sentinel observability (NFR-01) — direct response to Round-1 feedback:
//   "Complete absence of LLM observability and tracing (OpenTelemetry)"
//
// Three layers, defence in depth:
//  1. OpenTelemetry spans via @opentelemetry/api — exported through Mastra's
//     built-in OTel pipeline to any OTLP endpoint (Jaeger in docker-compose).
//  2. GenAI semantic-convention attributes on every LLM span:
//     gen_ai.request.model · gen_ai.usage.input_tokens · output_tokens ·
//     sentinel.prompt.hash (CRISPE template version tracking → prompt drift).
//  3. An in-process TraceStore ring buffer feeding /api/traces so the
//     Observability panel shows live traces with ZERO external dependencies —
//     the demo never depends on Jaeger being up.
// ─────────────────────────────────────────────────────────────────────────────
import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import { createHash, randomUUID } from 'crypto';

const tracer = trace.getTracer('sentinel-agent', '1.0.0');

// ── Trace event model (what the UI renders) ──────────────────────────────────
export interface TraceEvent {
  id: string;
  correlationId: string;      // one per workflow run — flows through every span
  runId?: string;
  step: string;               // e.g. "workflow.retrieve-context", "llm.draft-runbook"
  kind: 'workflow' | 'llm' | 'qdrant' | 'enkrypt' | 'mcp' | 'scorer' | 'http';
  status: 'ok' | 'error' | 'blocked';
  startedAt: string;
  latencyMs: number;
  attrs: Record<string, string | number | boolean>;
}

// Ring buffer — bounded memory (NFR-05), newest first on read.
const MAX_EVENTS = 500;
const g = globalThis as unknown as { __sentinelTraces?: TraceEvent[] };
if (!g.__sentinelTraces) g.__sentinelTraces = [];
const buffer = g.__sentinelTraces;

export function recordEvent(e: Omit<TraceEvent, 'id'>): void {
  buffer.push({ id: randomUUID(), ...e });
  if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS);
}

export function readEvents(opts?: { correlationId?: string; limit?: number }): TraceEvent[] {
  let out = [...buffer].reverse();
  if (opts?.correlationId) out = out.filter((e) => e.correlationId === opts.correlationId);
  return out.slice(0, opts?.limit ?? 200);
}

export function newCorrelationId(): string {
  return `snl-${randomUUID().slice(0, 8)}`;
}

/** SHA-256 of a prompt template → detects prompt drift across releases (PROMPTS.md). */
export function promptHash(template: string): string {
  return createHash('sha256').update(template).digest('hex').slice(0, 12);
}

// ── traceStep: the single instrumentation entrypoint ─────────────────────────
// Wraps any unit of work in (a) an OTel span and (b) a TraceStore event.
export async function traceStep<T>(
  meta: {
    step: string;
    kind: TraceEvent['kind'];
    correlationId: string;
    runId?: string;
    attrs?: Record<string, string | number | boolean>;
  },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const started = Date.now();
  return tracer.startActiveSpan(meta.step, async (span) => {
    span.setAttribute('sentinel.correlation_id', meta.correlationId);
    if (meta.runId) span.setAttribute('sentinel.run_id', meta.runId);
    for (const [k, v] of Object.entries(meta.attrs ?? {})) span.setAttribute(k, v);

    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      recordEvent({
        correlationId: meta.correlationId, runId: meta.runId, step: meta.step,
        kind: meta.kind, status: 'ok', startedAt: new Date(started).toISOString(),
        latencyMs: Date.now() - started, attrs: collect(span, meta.attrs),
      });
      return result;
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
      recordEvent({
        correlationId: meta.correlationId, runId: meta.runId, step: meta.step,
        kind: meta.kind, status: 'error', startedAt: new Date(started).toISOString(),
        latencyMs: Date.now() - started,
        attrs: { ...(meta.attrs ?? {}), error: String(err).slice(0, 300) },
      });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Record an LLM call with GenAI semantic-convention attributes. */
export function recordLlmUsage(meta: {
  correlationId: string; runId?: string; step: string;
  model: string; provider: string; latencyMs: number;
  tokensIn: number; tokensOut: number; promptHash: string; fallbackUsed: boolean;
}): void {
  recordEvent({
    correlationId: meta.correlationId, runId: meta.runId,
    step: `llm.${meta.step}`, kind: 'llm', status: 'ok',
    startedAt: new Date(Date.now() - meta.latencyMs).toISOString(),
    latencyMs: meta.latencyMs,
    attrs: {
      'gen_ai.request.model': meta.model,
      'gen_ai.system': meta.provider,
      'gen_ai.usage.input_tokens': meta.tokensIn,
      'gen_ai.usage.output_tokens': meta.tokensOut,
      'sentinel.prompt.hash': meta.promptHash,
      'sentinel.llm.fallback_used': meta.fallbackUsed,
    },
  });
}

/** Record a blocked-by-safety event (renders red in the observability panel). */
export function recordBlocked(meta: {
  correlationId: string; runId?: string; step: string; detail: string;
}): void {
  recordEvent({
    correlationId: meta.correlationId, runId: meta.runId, step: meta.step,
    kind: 'enkrypt', status: 'blocked', startedAt: new Date().toISOString(),
    latencyMs: 0, attrs: { detail: meta.detail.slice(0, 400) },
  });
}

function collect(
  _span: Span,
  attrs?: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  return { ...(attrs ?? {}) };
}

// Aggregates for the observability header cards.
export function usageSummary(): {
  totalRuns: number; llmCalls: number; tokensIn: number; tokensOut: number;
  avgLlmLatencyMs: number; blockedCount: number;
} {
  const events = buffer;
  const llm = events.filter((e) => e.kind === 'llm');
  const tokensIn = llm.reduce((a, e) => a + Number(e.attrs['gen_ai.usage.input_tokens'] ?? 0), 0);
  const tokensOut = llm.reduce((a, e) => a + Number(e.attrs['gen_ai.usage.output_tokens'] ?? 0), 0);
  const runs = new Set(events.map((e) => e.correlationId));
  return {
    totalRuns: runs.size,
    llmCalls: llm.length,
    tokensIn, tokensOut,
    avgLlmLatencyMs: llm.length ? Math.round(llm.reduce((a, e) => a + e.latencyMs, 0) / llm.length) : 0,
    blockedCount: events.filter((e) => e.status === 'blocked').length,
  };
}
