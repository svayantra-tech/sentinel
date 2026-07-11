// ─────────────────────────────────────────────────────────────────────────────
// Sentinel run registry (supports FR-01..FR-12 UI surface)
//
// Maps runId → live SentinelRunView (what the dashboards poll) and holds the
// Mastra run handle so /api/runs/[id]/approve can resume the suspended
// workflow. Registry lives on globalThis to survive Next.js dev hot-reloads.
// In serverless production, workflow state itself is durable in Mastra's
// LibSQL storage (MASTRA_DB_URL → Turso); this registry is a UI projection.
// ─────────────────────────────────────────────────────────────────────────────
import type { RunStage, SentinelRunView, FaultInput } from '@/lib/types';
import { publishStage } from '@/lib/event-bus';

export interface RegisteredRun {
  view: SentinelRunView;
  // The live Mastra run handle (typed loosely to isolate Mastra API drift).
  handle?: { resume: (args: { step: string; resumeData: unknown }) => Promise<unknown> };
}

const g = globalThis as unknown as { __sentinelRuns?: Map<string, RegisteredRun> };
if (!g.__sentinelRuns) g.__sentinelRuns = new Map();
const runs = g.__sentinelRuns;

export function createRunView(runId: string, correlationId: string, fault: FaultInput): SentinelRunView {
  const view: SentinelRunView = {
    runId, correlationId, fault,
    stage: 'FAULT_INGESTED',
    timeline: [{ at: new Date().toISOString(), stage: 'FAULT_INGESTED', note: `Fault ${fault.faultCode} on ${fault.equipmentId} reported by ${fault.reportedBy}` }],
    startedAt: new Date().toISOString(),
  };
  runs.set(runId, { view });
  publishStage(view, view.timeline[0]?.note); // live-stream tap (additive, no logic change)
  return view;
}

export function attachHandle(runId: string, handle: RegisteredRun['handle']): void {
  const r = runs.get(runId);
  if (r) r.handle = handle;
}

/**
 * Insert a fully-formed view into the registry — used to cache a projection
 * rehydrated from durable Mastra storage after a process restart (serverless),
 * so subsequent dashboard polls are served from memory. Never clobbers a live
 * entry (which may already hold the resume handle).
 */
export function registerRunView(view: SentinelRunView): void {
  if (!runs.has(view.runId)) runs.set(view.runId, { view });
}

export function getRun(runId: string): RegisteredRun | undefined {
  return runs.get(runId);
}

export function listRuns(): SentinelRunView[] {
  return [...runs.values()].map((r) => r.view).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function patchRun(runId: string, patch: Partial<SentinelRunView>, note?: string): void {
  const r = runs.get(runId);
  if (!r) return;
  Object.assign(r.view, patch);
  if (patch.stage) {
    r.view.timeline.push({ at: new Date().toISOString(), stage: patch.stage as RunStage, note: note ?? '' });
    publishStage(r.view, note); // live-stream tap (additive, no logic change)
  }
}
