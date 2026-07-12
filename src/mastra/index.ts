// ─────────────────────────────────────────────────────────────────────────────
// Sentinel Mastra instance + run orchestration (NFR-01/NFR-07)
//
//  · LibSQLStore persists workflow state → suspend/resume survives restarts
//    (local file in dev; Turso URL in serverless prod — 12-Factor).
//  · Built-in Mastra telemetry exports OTLP when OTEL_EXPORTER_OTLP_ENDPOINT
//    is set (Jaeger from docker-compose); the in-process TraceStore powers the
//    live Observability panel regardless.
// ─────────────────────────────────────────────────────────────────────────────
import { Mastra } from '@mastra/core';
import { Observability, DefaultExporter } from '@mastra/observability';
import { LibSQLStore } from '@mastra/libsql';
import { sentinelWorkflow, APPROVAL_STEP_ID, type SentinelState } from './workflow';
import type { FaultInput, SessionUser, SentinelRunView, RunStage } from '@/lib/types';
import { newCorrelationId } from '@/lib/telemetry';
import { createRunView, attachHandle, getRun, patchRun, registerRunView, listRuns } from '@/lib/run-registry';
import { ensureSeeded } from '@/lib/memory';
import { healthCheckLLM } from '@/lib/llm';

const g = globalThis as unknown as { __sentinelMastra?: Mastra };

export function getMastra(): Mastra {
  if (!g.__sentinelMastra) {
    // TASK 1.3: on first Mastra bootstrap, if DEMO_MODE=live but the LLM chain is
    // unreachable, print a stderr banner so the operator knows before demoing.
    void healthCheckLLM();
    g.__sentinelMastra = new Mastra({
      workflows: { sentinelWorkflow },
      storage: new LibSQLStore({
        id: 'sentinel-storage',
        url: process.env.MASTRA_DB_URL || 'file:./sentinel.db',
        authToken: process.env.MASTRA_DB_AUTH_TOKEN,
      }),
      // Mastra 1.x observability registry — spans persisted to Mastra storage.
      // OTLP export to Jaeger is wired independently in src/instrumentation.ts
      // via the OpenTelemetry NodeSDK (see docs/OBSERVABILITY.md).
      observability: new Observability({
        configs: {
          sentinel: {
            serviceName: 'sentinel-agent',
            exporters: [new DefaultExporter()],
          },
        },
      }),
    });
  }
  return g.__sentinelMastra;
}

// On a persistent server the event loop keeps draining a fire-and-forget workflow
// promise after the HTTP response is sent, so the run marches to its SUSPENDED gate
// on its own and the UI polls it live. On serverless (Vercel) the instance is FROZEN
// the moment the response returns — background work stalls wherever it happened to be
// (observed: stuck at SCORED, never reaching SUSPENDED). So when running serverless we
// must DRIVE the real workflow to its next durable checkpoint INSIDE the request. This
// is not faking progress: it is the same real run.start()/run.resume() awaited to the
// point Mastra persists (suspend or terminal) instead of left dangling. Env-gated so
// local dev/smoke/e2e keep their instant-return + live-poll behavior unchanged.
const DRIVE_IN_REQUEST = !!process.env.VERCEL || process.env.SENTINEL_AWAIT_WORKFLOW === '1';

/** Start a Sentinel run. Returns once the run is SUSPENDED/terminal on serverless,
 *  or immediately on a persistent server (the UI polls /api/runs/[id]). */
export async function startSentinelRun(fault: FaultInput, user: SessionUser): Promise<{ runId: string; correlationId: string }> {
  await ensureSeeded();
  const mastra = getMastra();
  const wf = mastra.getWorkflow('sentinelWorkflow');
  const run = await wf.createRun();
  const correlationId = newCorrelationId();

  createRunView(run.runId, correlationId, fault);
  attachHandle(run.runId, {
    resume: (args) => run.resume(args as never),
  });

  const initial: SentinelState = {
    correlationId, runId: run.runId, fault,
    technicianId: user.sub, authLevel: user.authLevel,
  };

  // run.start() resolves when the workflow suspends at the HITL gate (or terminates).
  const started = run
    .start({ inputData: initial })
    .then((result) => {
      // status: 'suspended' at the HITL gate is the expected mid-state.
      if (result.status === 'failed') {
        patchRun(run.runId, { stage: 'FAILED', finishedAt: new Date().toISOString() },
          `Workflow failed: ${String((result as { error?: unknown }).error ?? 'unknown')}`);
      }
    })
    .catch((err) => {
      patchRun(run.runId, { stage: 'FAILED', finishedAt: new Date().toISOString() },
        `Workflow error: ${String(err)}`);
    });

  if (DRIVE_IN_REQUEST) await started; // serverless: reach the suspend gate before responding

  return { runId: run.runId, correlationId };
}

/** Resume a suspended run at the technician-approval gate. */
export async function resumeSentinelRun(
  runId: string,
  resumeData: { approved: boolean; technicianId: string; notes?: string },
): Promise<{ ok: boolean; error?: string }> {
  const doResume = async (handle: { resume: (args: { step: string; resumeData: unknown }) => Promise<unknown> }) => {
    // resume() runs the post-gate steps (execute → post-mortem → write-back) to DONE.
    const resumed = handle
      .resume({ step: APPROVAL_STEP_ID, resumeData })
      .catch((err) => {
        patchRun(runId, { stage: 'FAILED', finishedAt: new Date().toISOString() },
          `Resume error: ${String(err)}`);
      });
    // Serverless: drive resume to DONE in-request, else the frozen instance would
    // strand the post-mortem + memory write-back (the failure the demo hits on Vercel).
    if (DRIVE_IN_REQUEST) await resumed;
  };

  // Fast path: the live handle is still in memory (same process, incl. dev HMR).
  const reg = getRun(runId);
  if (reg?.handle) {
    await doResume(reg.handle);
    return { ok: true };
  }

  // Slow path: the process restarted (the serverless failure mode). The in-memory
  // registry/handle is gone, but the workflow snapshot is durable in Mastra storage
  // (Turso in prod, local file in dev). Rehydrate by id, rebuild the UI projection
  // from the persisted input, and resume. THIS is what durable storage exists for.
  try {
    const wf = getMastra().getWorkflow('sentinelWorkflow');
    const persisted = await wf.getWorkflowRunById(runId);
    if (!persisted) return { ok: false, error: 'Unknown run' };
    if (persisted.status !== 'suspended') {
      return { ok: false, error: `Run is ${persisted.status}, not resumable` };
    }
    // Rebuild the run-registry view if this process never saw it (post-restart),
    // so the dashboards can render the run through resume → DONE.
    if (!reg) {
      const view = viewFromPersisted(runId, persisted);
      if (view) registerRunView(view);
    }
    const run = await wf.createRun({ runId });
    const handle = { resume: (args: { step: string; resumeData: unknown }) => run.resume(args as never) };
    attachHandle(runId, handle);
    await doResume(handle);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not rehydrate run: ${String(err)}` };
  }
}

// ── Read-path rehydration (serverless cold-process reads — FR-01..FR-12) ──────
// The run-registry is an in-memory UI projection; on Vercel a dashboard poll can
// hit a process that never ran the workflow, so the run is absent from memory.
// These helpers rebuild the SentinelRunView from the durable Mastra snapshot so a
// SUSPENDED run (the demo climax) renders instead of 404-ing.

/** Map a persisted workflow status + accumulated state to a Sentinel run stage. */
function stageFromPersisted(status: string, s: Partial<SentinelState>): RunStage {
  if (status === 'suspended') return 'SUSPENDED';
  if (status === 'success') return 'DONE';
  if (status === 'failed' || status === 'canceled') return 'FAILED';
  if (s.approval) return 'EXECUTING';
  if (s.safety) return 'SAFETY_CHECKED';
  if (s.scorecard) return 'SCORED';
  if (s.runbook) return 'RUNBOOK_DRAFTED';
  if (s.context) return 'CONTEXT_RETRIEVED';
  return 'FAULT_INGESTED';
}

/**
 * Each workflow step returns the whole accumulated State ({ ...s, … }); pick the
 * richest one available (latest step wins) so the rebuilt view carries context,
 * runbook, safety report and corrected runbook — not just the initial fault.
 */
function accumulatedState(persisted: { payload?: unknown; steps?: Record<string, unknown> }): Partial<SentinelState> {
  const steps = (persisted.steps ?? {}) as Record<string, { payload?: unknown; output?: unknown }>;
  const order = ['execute-and-close', 'technician-approval', 'safety-gate', 'draft-and-score', 'retrieve-context', 'ingest-fault'];
  const hasFault = (v: unknown): v is Partial<SentinelState> => !!v && typeof v === 'object' && 'fault' in (v as object);
  for (const id of order) {
    const step = steps[id];
    if (!step) continue;
    if (hasFault(step.payload)) return step.payload; // input = state as of this step
    if (hasFault(step.output)) return step.output;
  }
  return hasFault(persisted.payload) ? persisted.payload : {};
}

/** Rebuild a SentinelRunView from a persisted Mastra workflow snapshot (or null). */
function viewFromPersisted(runId: string, persisted: { status: string; payload?: unknown; steps?: Record<string, unknown> }): SentinelRunView | null {
  const s = accumulatedState(persisted);
  if (!s.fault || !s.correlationId) return null;
  const stage = stageFromPersisted(persisted.status, s);
  const at = new Date().toISOString();
  const timeline: SentinelRunView['timeline'] = [{ at, stage: 'FAULT_INGESTED', note: `Fault ${s.fault.faultCode} on ${s.fault.equipmentId} (rehydrated from durable storage)` }];
  if (s.context) timeline.push({ at, stage: 'CONTEXT_RETRIEVED', note: 'Qdrant context (rehydrated)' });
  if (s.runbook) timeline.push({ at, stage: 'RUNBOOK_DRAFTED', note: 'Runbook drafted (rehydrated)' });
  if (s.scorecard) timeline.push({ at, stage: 'SCORED', note: 'Scored (rehydrated)' });
  if (s.safety) {
    const blocked = s.safety.violations.filter((v) => v.severity === 'block');
    timeline.push({ at, stage: 'SAFETY_CHECKED', note: blocked.length ? `⛔ ${blocked.length} blocked: ${blocked.map((v) => v.type).join(', ')} (rehydrated)` : 'Safety gate clear (rehydrated)' });
  }
  if (stage === 'SUSPENDED') timeline.push({ at, stage: 'SUSPENDED', note: 'Rehydrated from persisted Mastra storage — durable across process restarts' });
  return {
    runId, correlationId: s.correlationId, fault: s.fault, stage,
    workOrderId: s.workOrderId, context: s.context, runbook: s.runbook,
    scorecard: s.scorecard, safety: s.safety, correctedRunbook: s.correctedRunbook,
    approval: s.approval, timeline, startedAt: at,
    finishedAt: stage === 'DONE' || stage === 'FAILED' ? at : undefined,
  };
}

/** A single run's view — in-memory if present, else rehydrated from durable storage. */
export async function getRunView(runId: string): Promise<SentinelRunView | null> {
  const reg = getRun(runId);
  if (reg) return reg.view;
  try {
    const wf = getMastra().getWorkflow('sentinelWorkflow');
    const persisted = await wf.getWorkflowRunById(runId);
    if (!persisted) return null;
    const view = viewFromPersisted(runId, persisted);
    if (view) registerRunView(view); // cache so later polls (and resume) hit memory
    return view;
  } catch {
    return null;
  }
}

/** All run views — in-memory ∪ persisted (in-memory wins), newest first. */
export async function listRunViews(): Promise<SentinelRunView[]> {
  const byId = new Map<string, SentinelRunView>(listRuns().map((v) => [v.runId, v]));
  try {
    const wf = getMastra().getWorkflow('sentinelWorkflow');
    const { runs } = await wf.listWorkflowRuns();
    for (const r of runs) {
      if (byId.has(r.runId)) continue;
      const persisted = await wf.getWorkflowRunById(r.runId).catch(() => null);
      const view = persisted ? viewFromPersisted(r.runId, persisted) : null;
      if (view) { byId.set(r.runId, view); registerRunView(view); }
    }
  } catch {
    // durable storage unavailable — fall back to the in-memory projection only
  }
  return [...byId.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
