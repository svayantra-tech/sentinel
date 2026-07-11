// ─────────────────────────────────────────────────────────────────────────────
// Sentinel live event bus — the real-time channel between the pipeline and the
// visualizer (SSE). PURELY ADDITIVE observability: publishers are one-line taps
// at boundaries the backend already crosses (patchRun stage transitions and
// traceStep events). Nothing here alters workflow logic; every event is a
// truthful readout of state the pipeline already produced.
//
// globalThis-backed (like run-registry / TraceStore) so dev HMR and multiple
// route modules share one bus. Ring buffer + monotonic seq → SSE clients replay
// missed events on (re)connect via Last-Event-ID.
// Serverless caveat: the bus is per-process; on Vercel a subscriber only sees
// events from its own instance. The UI keeps its existing /api/runs polling as
// fallback — SSE is the low-latency path, not the only path.
// ─────────────────────────────────────────────────────────────────────────────
import type { RunStage, SentinelRunView } from './types';

export interface LiveEvent {
  seq: number;
  at: string;                    // ISO timestamp
  type: 'stage' | 'trace';
  runId?: string;
  correlationId?: string;
  // type='stage' — a real workflow stage transition (from patchRun/createRunView)
  stage?: RunStage;
  note?: string;
  payload?: {
    workOrderId?: string;
    scorecard?: { relevance: number; safety: number; completeness: number; pass: boolean };
    safety?: {
      cloudUsed: boolean;
      violations: Array<{ type: string; severity: string; source: string; detail: string; correction?: string; stepN?: number }>;
    };
    contextCounts?: { incidents: number; manualChunks: number; runbooks: number };
    approval?: { approved: boolean; technicianId: string };
    faultCode?: string;
    equipmentId?: string;
  };
  // type='trace' — a real traceStep/LLM/blocked event (from telemetry.recordEvent)
  step?: string;
  kind?: string;                 // workflow | llm | qdrant | enkrypt | mcp | scorer | http
  status?: string;               // ok | error | blocked
  latencyMs?: number;
  attrs?: Record<string, string | number | boolean>;
}

type Subscriber = (e: LiveEvent) => void;

const MAX_BUFFER = 300;
const g = globalThis as unknown as {
  __sentinelBus?: { seq: number; buffer: LiveEvent[]; subs: Set<Subscriber> };
};
if (!g.__sentinelBus) g.__sentinelBus = { seq: 0, buffer: [], subs: new Set() };
const bus = g.__sentinelBus;

function emit(e: Omit<LiveEvent, 'seq' | 'at'>): void {
  const full: LiveEvent = { seq: ++bus.seq, at: new Date().toISOString(), ...e };
  bus.buffer.push(full);
  if (bus.buffer.length > MAX_BUFFER) bus.buffer.splice(0, bus.buffer.length - MAX_BUFFER);
  for (const s of bus.subs) {
    try { s(full); } catch { /* a broken subscriber must never break the pipeline */ }
  }
}

/** Tap for run-registry: publish a REAL stage transition with its structured payload. */
export function publishStage(view: SentinelRunView, note?: string): void {
  emit({
    type: 'stage', runId: view.runId, correlationId: view.correlationId,
    stage: view.stage, note,
    payload: {
      faultCode: view.fault.faultCode,
      equipmentId: view.fault.equipmentId,
      workOrderId: view.workOrderId,
      scorecard: view.scorecard
        ? { relevance: view.scorecard.relevance, safety: view.scorecard.safety, completeness: view.scorecard.completeness, pass: view.scorecard.pass }
        : undefined,
      safety: view.safety
        ? {
            cloudUsed: view.safety.cloudUsed,
            violations: view.safety.violations.map((v) => ({
              type: v.type, severity: v.severity, source: v.source,
              detail: v.detail, correction: v.correction, stepN: v.stepN,
            })),
          }
        : undefined,
      contextCounts: view.context
        ? { incidents: view.context.incidents.length, manualChunks: view.context.manualChunks.length, runbooks: view.context.runbooks.length }
        : undefined,
      approval: view.approval
        ? { approved: view.approval.approved, technicianId: view.approval.technicianId }
        : undefined,
    },
  });
}

/** Tap for telemetry: publish a REAL trace event (llm/qdrant/enkrypt/mcp/…). */
export function publishTrace(e: {
  correlationId: string; runId?: string; step: string; kind: string;
  status: string; latencyMs: number; attrs: Record<string, string | number | boolean>;
}): void {
  emit({
    type: 'trace', runId: e.runId, correlationId: e.correlationId,
    step: e.step, kind: e.kind, status: e.status, latencyMs: e.latencyMs, attrs: e.attrs,
  });
}

/** Subscribe to live events; returns an unsubscribe fn. */
export function subscribe(fn: Subscriber): () => void {
  bus.subs.add(fn);
  return () => bus.subs.delete(fn);
}

/** Buffered events with seq > afterSeq (SSE replay on connect / reconnect). */
export function replaySince(afterSeq: number): LiveEvent[] {
  return bus.buffer.filter((e) => e.seq > afterSeq);
}
