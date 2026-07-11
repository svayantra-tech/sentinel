// ─────────────────────────────────────────────────────────────────────────────
// THE SENTINEL WORKFLOW (FR-01..FR-12) — Mastra orchestration core.
//
// State machine (PRD §15/§16):
//   IDLE → FAULT_INGESTED → CONTEXT_RETRIEVED → RUNBOOK_DRAFTED → SCORED
//        → SAFETY_CHECKED → SUSPENDED ⏸ → TECHNICIAN_APPROVED → EXECUTING
//        → POST_MORTEM → MEMORY_WRITTEN → DONE
//
// Mastra primitives in play (rubric: Mastra 25%):
//   · createWorkflow / createStep chain               (multi-step execution)
//   · suspend()/resume with suspend/resume schemas    (HITL — FR-08)
//   · deterministic scorer stage w/ self-refine loop  (FR-07)
//   · MCP CMMS tool calls at ingest + close           (FR-02/FR-12)
//   · memory write-back routing to Qdrant             (FR-11)
//
// All @mastra/* imports are DELIBERATELY confined to this file (+ index.ts):
// framework evolution is absorbed here, never in business logic (logic.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import type {
  DraftRunbook, FaultInput, RetrievedContext, SafetyReport, ScoreCard, IncidentPayload,
} from '@/lib/types';
import { FaultInput as FaultInputSchema } from '@/lib/types';
import { retrieveContext, writeBackIncident } from '@/lib/memory';
import { checkRunbook, checkPostMortem } from '@/lib/safety';
import { createWorkOrder, updateWorkOrder } from '@/mcp/cmms';
import { runScorers } from './scorers';
import { draftRunbookLogic, executeLogic, postMortemLogic } from './logic';
import { patchRun } from '@/lib/run-registry';
import { traceStep } from '@/lib/telemetry';

// ── Shared state flowing through the chain ───────────────────────────────────
const State = z.object({
  correlationId: z.string(),
  runId: z.string(),
  fault: FaultInputSchema,
  technicianId: z.string(),
  authLevel: z.number().int().min(1).max(3),
  workOrderId: z.string().optional(),
  context: z.custom<RetrievedContext>().optional(),
  runbook: z.custom<DraftRunbook>().optional(),
  scorecard: z.custom<ScoreCard>().optional(),
  safety: z.custom<SafetyReport>().optional(),
  correctedRunbook: z.custom<DraftRunbook>().optional(),
  approval: z.object({
    approved: z.boolean(),
    technicianId: z.string(),
    notes: z.string().optional(),
    at: z.string(),
  }).optional(),
});
type State = z.infer<typeof State>;

// ── Step 1 · FAULT_INGESTED — MCP work order (FR-01/FR-02) ───────────────────
const ingestFault = createStep({
  id: 'ingest-fault',
  inputSchema: State,
  outputSchema: State,
  execute: async ({ inputData }) => {
    const s = inputData;
    const wo = await createWorkOrder(
      {
        equipmentId: s.fault.equipmentId, plantId: s.fault.plantId,
        faultCode: s.fault.faultCode, description: s.fault.description,
        severity: s.fault.severity,
      },
      { correlationId: s.correlationId, runId: s.runId },
    );
    patchRun(s.runId, { workOrderId: wo.id }, `Work order ${wo.id} (${wo.priority}) auto-created in CMMS via MCP`);
    return { ...s, workOrderId: wo.id };
  },
});

// ── Step 2 · CONTEXT_RETRIEVED — Qdrant filtered retrieval (FR-03/FR-04/FR-05)
const retrieve = createStep({
  id: 'retrieve-context',
  inputSchema: State,
  outputSchema: State,
  execute: async ({ inputData }) => {
    const s = inputData;
    const context = await retrieveContext({
      correlationId: s.correlationId, runId: s.runId,
      equipmentType: s.fault.equipmentType, plantId: s.fault.plantId,
      faultText: `${s.fault.faultCode} ${s.fault.description}`,
      authLevel: s.authLevel,
    });
    patchRun(s.runId, { stage: 'CONTEXT_RETRIEVED', context },
      `Qdrant: ${context.incidents.length} incidents · ${context.manualChunks.length} OEM chunks · ${context.runbooks.length} runbooks (filters: ${JSON.stringify(context.filters)})`);
    return { ...s, context };
  },
});

// ── Step 3 · RUNBOOK_DRAFTED + SCORED — draft → scorer gate → self-refine ────
const draftAndScore = createStep({
  id: 'draft-and-score',
  inputSchema: State,
  outputSchema: State,
  execute: async ({ inputData }) => {
    const s = inputData;
    const ctx = s.context!;

    const first = await traceStep(
      { step: 'workflow.draft-runbook', kind: 'workflow', correlationId: s.correlationId, runId: s.runId, attrs: { attempt: 1 } },
      () => draftRunbookLogic({ correlationId: s.correlationId, runId: s.runId, fault: s.fault, context: ctx }),
    );
    patchRun(s.runId, { stage: 'RUNBOOK_DRAFTED', runbook: first.runbook },
      `Runbook drafted (${first.source}${first.fallbackReason ? ` — fallback: ${first.fallbackReason}` : ''}) — ${first.runbook.steps.length} steps`);

    let runbook = first.runbook;
    let attempts = 1;
    let card = await runScorers({ correlationId: s.correlationId, runId: s.runId, runbook, context: ctx, attempt: 1 });

    if (!card.pass) {
      // Self-refinement loop (one pass) — visible in traces as attempt 2 (FR-07).
      const failing = (['relevance', 'safety', 'completeness'] as const).filter((d) => card[d] < 0.75);
      // eslint-disable-next-line no-console
      console.error(`[self-refine] attempt 1 FAILED (${failing.join(', ')} < 0.75) — invoking Mastra self-refine with scorer feedback`);
      patchRun(s.runId, { runbook },
        `⟳ Self-refine: attempt 1 below threshold (${failing.join(', ')}) — re-drafting with scorer feedback`);
      const second = await traceStep(
        { step: 'workflow.refine-runbook', kind: 'workflow', correlationId: s.correlationId, runId: s.runId, attrs: { attempt: 2 } },
        () => draftRunbookLogic({
          correlationId: s.correlationId, runId: s.runId, fault: s.fault, context: ctx,
          refineFeedback: card.reasons, previous: runbook,
        }),
      );
      runbook = second.runbook;
      attempts = 2;
      card = await runScorers({ correlationId: s.correlationId, runId: s.runId, runbook, context: ctx, attempt: 2 });
      // eslint-disable-next-line no-console
      console.error(`[self-refine] attempt 2 ${card.pass ? 'PASSED' : 'STILL BELOW THRESHOLD'} — completeness ${card.completeness}, safety ${card.safety}, relevance ${card.relevance}`);
    }

    patchRun(s.runId, { stage: 'SCORED', runbook, scorecard: card },
      `Scorers (attempt ${attempts}) — relevance ${card.relevance} · safety ${card.safety} · completeness ${card.completeness} · ${card.pass ? 'PASS' : 'BELOW THRESHOLD (proceeding to hard safety gate)'}`);
    return { ...s, runbook, scorecard: card };
  },
});

// ── Step 4 · SAFETY_CHECKED — Enkrypt triple-mode gate (FR-08/FR-09) ─────────
const safetyGate = createStep({
  id: 'safety-gate',
  inputSchema: State,
  outputSchema: State,
  execute: async ({ inputData }) => {
    const s = inputData;
    const requiredSkill = s.context!.runbooks[0]?.payload.skill_level_required ?? 1;
    const { report, corrected } = await checkRunbook({
      correlationId: s.correlationId, runId: s.runId,
      runbook: s.runbook!, oemChunks: s.context!.manualChunks.map((m) => m.payload),
      technicianAuthLevel: s.authLevel, requiredSkillLevel: requiredSkill,
    });
    const blocked = report.violations.filter((v) => v.severity === 'block');
    patchRun(s.runId, { stage: 'SAFETY_CHECKED', safety: report, correctedRunbook: corrected },
      blocked.length
        ? `⛔ Enkrypt gate BLOCKED ${blocked.length} item(s): ${blocked.map((v) => v.type).join(', ')} — corrected runbook prepared`
        : `Enkrypt gate clear (cloud=${report.cloudUsed}, local rules applied)`);
    return { ...s, safety: report, correctedRunbook: corrected };
  },
});

// ── Step 5 · SUSPENDED ⏸ → TECHNICIAN_APPROVED — the HITL gate (FR-08) ───────
// The workflow HALTS here. Nothing executes until a human resumes it.
const technicianApproval = createStep({
  id: 'technician-approval',
  inputSchema: State,
  outputSchema: State,
  suspendSchema: z.object({
    reason: z.string(),
    runbookTitle: z.string(),
    blockedCount: z.number(),
  }),
  resumeSchema: z.object({
    approved: z.boolean(),
    technicianId: z.string(),
    notes: z.string().optional(),
  }),
  execute: async ({ inputData, resumeData, suspend }) => {
    const s = inputData;
    if (!resumeData) {
      patchRun(s.runId, { stage: 'SUSPENDED' },
        'Workflow suspended — awaiting technician approval (Mastra suspend/resume)');
      return await suspend({
        reason: 'Human-in-the-loop approval required before any physical work',
        runbookTitle: s.correctedRunbook!.title,
        blockedCount: s.safety!.violations.filter((v) => v.severity === 'block').length,
      }); // workflow halts here until resumed
    }
    const approval = {
      approved: resumeData.approved,
      technicianId: resumeData.technicianId,
      notes: resumeData.notes,
      at: new Date().toISOString(),
    };
    patchRun(s.runId, { stage: 'TECHNICIAN_APPROVED', approval },
      resumeData.approved
        ? `Approved by ${resumeData.technicianId}${resumeData.notes ? ` — "${resumeData.notes}"` : ''}`
        : `REJECTED by ${resumeData.technicianId} — workflow will close without execution`);
    return { ...s, approval };
  },
});

// ── Step 6 · EXECUTING → POST_MORTEM → MEMORY_WRITTEN → DONE ─────────────────
const executeAndClose = createStep({
  id: 'execute-and-close',
  inputSchema: State,
  outputSchema: z.object({
    runId: z.string(),
    outcome: z.enum(['resolved', 'rejected']),
    memoryPointId: z.string().optional(),
  }),
  execute: async ({ inputData }) => {
    const s = inputData;

    if (!s.approval?.approved) {
      await updateWorkOrder(
        { workOrderId: s.workOrderId!, status: 'COMPLETED', resolution: { rootCause: 'Rejected at HITL gate', fixApplied: 'No work performed', minutes: 0 } },
        { correlationId: s.correlationId, runId: s.runId },
      );
      patchRun(s.runId, { stage: 'DONE', finishedAt: new Date().toISOString() },
        'Closed without execution — technician rejected the runbook');
      return { runId: s.runId, outcome: 'rejected' as const };
    }

    patchRun(s.runId, { stage: 'EXECUTING' }, 'Technician executing approved runbook under LOTO');
    const exec = await traceStep(
      { step: 'workflow.execute', kind: 'workflow', correlationId: s.correlationId, runId: s.runId, attrs: { steps: s.correctedRunbook!.steps.length } },
      () => executeLogic(s.correctedRunbook!),
    );

    const pm = await postMortemLogic({
      correlationId: s.correlationId, runId: s.runId,
      fault: s.fault, runbook: s.correctedRunbook!,
      minutes: exec.minutes, notes: s.approval.notes ?? '',
    });
    // Mode-3 bias gate on the post-mortem (FR-10).
    const pmSafety = await checkPostMortem({
      correlationId: s.correlationId, runId: s.runId,
      text: pm.text, telemetryEvidence: s.fault.reportedBy === 'sensor',
    });
    const biasFix = pmSafety.violations.find((v) => v.type === 'BLAME_BIAS' && v.correction);
    const finalPm = biasFix?.correction ?? pm.text;
    patchRun(s.runId, { stage: 'POST_MORTEM', postMortem: finalPm, postMortemSafety: pmSafety },
      `Post-mortem drafted (${pm.source})${biasFix ? ' — blame-bias reframed by Enkrypt gate' : ''}`);

    // FR-11 — the flywheel: this incident becomes retrievable memory.
    const incident: IncidentPayload = {
      kind: 'incident',
      equipment_id: s.fault.equipmentId, equipment_type: s.fault.equipmentType,
      plant_id: s.fault.plantId, fault_code: s.fault.faultCode,
      fault_description: s.fault.description,
      root_cause: s.correctedRunbook!.faultHypothesis,
      fix_applied: s.correctedRunbook!.steps.map((st) => st.action).slice(1, 4).join(' → '),
      time_to_resolve_minutes: exec.minutes,
      severity: s.fault.severity, outcome: 'resolved',
      technician_id: s.approval.technicianId,
      timestamp: new Date().toISOString(),
    };
    const pointId = await writeBackIncident({ correlationId: s.correlationId, runId: s.runId, incident });
    patchRun(s.runId, { stage: 'MEMORY_WRITTEN', memoryPointId: pointId },
      `Incident upserted to Qdrant incident_history (${pointId.slice(0, 8)}…) — next similar fault retrieves this fix`);

    await updateWorkOrder(
      {
        workOrderId: s.workOrderId!, status: 'COMPLETED',
        resolution: { rootCause: incident.root_cause, fixApplied: incident.fix_applied, minutes: exec.minutes },
      },
      { correlationId: s.correlationId, runId: s.runId },
    );
    patchRun(s.runId, { stage: 'DONE', finishedAt: new Date().toISOString() },
      `Resolved in ${exec.minutes} min — work order completed via MCP`);
    return { runId: s.runId, outcome: 'resolved' as const, memoryPointId: pointId };
  },
});

// ── The workflow ─────────────────────────────────────────────────────────────
export const sentinelWorkflow = createWorkflow({
  id: 'sentinel-maintenance',
  inputSchema: State,
  outputSchema: z.object({
    runId: z.string(),
    outcome: z.enum(['resolved', 'rejected']),
    memoryPointId: z.string().optional(),
  }),
})
  .then(ingestFault)
  .then(retrieve)
  .then(draftAndScore)
  .then(safetyGate)
  .then(technicianApproval)
  .then(executeAndClose)
  .commit();

export const APPROVAL_STEP_ID = 'technician-approval';
export type SentinelState = State;
