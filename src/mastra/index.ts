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
import type { FaultInput, SessionUser } from '@/lib/types';
import { newCorrelationId } from '@/lib/telemetry';
import { createRunView, attachHandle, getRun, patchRun } from '@/lib/run-registry';
import { ensureSeeded } from '@/lib/memory';

const g = globalThis as unknown as { __sentinelMastra?: Mastra };

export function getMastra(): Mastra {
  if (!g.__sentinelMastra) {
    g.__sentinelMastra = new Mastra({
      workflows: { sentinelWorkflow },
      storage: new LibSQLStore({ id: 'sentinel-storage', url: process.env.MASTRA_DB_URL || 'file:./sentinel.db' }),
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

/** Start a Sentinel run. Fire-and-forget: the UI polls /api/runs/[id]. */
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

  void run
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

  return { runId: run.runId, correlationId };
}

/** Resume a suspended run at the technician-approval gate. */
export async function resumeSentinelRun(
  runId: string,
  resumeData: { approved: boolean; technicianId: string; notes?: string },
): Promise<{ ok: boolean; error?: string }> {
  const reg = getRun(runId);
  if (!reg) return { ok: false, error: 'Unknown run' };

  const doResume = async (handle: NonNullable<typeof reg.handle>) => {
    void handle
      .resume({ step: APPROVAL_STEP_ID, resumeData })
      .catch((err) => {
        patchRun(runId, { stage: 'FAILED', finishedAt: new Date().toISOString() },
          `Resume error: ${String(err)}`);
      });
  };

  if (reg.handle) {
    await doResume(reg.handle);
    return { ok: true };
  }

  // Handle lost (process restart) — recreate from persisted storage by runId.
  try {
    const wf = getMastra().getWorkflow('sentinelWorkflow');
    const run = await wf.createRun({ runId });
    const handle = { resume: (args: { step: string; resumeData: unknown }) => run.resume(args as never) };
    attachHandle(runId, handle);
    await doResume(handle);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not rehydrate run: ${String(err)}` };
  }
}
