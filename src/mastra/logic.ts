// ─────────────────────────────────────────────────────────────────────────────
// Sentinel step logic (FR-06/FR-10) — pure functions, zero framework imports.
//
// The Mastra workflow (workflow.ts) is thin wiring around these functions.
// Benefits: (1) unit-testable without an agent runtime (scripts/smoke.ts),
// (2) any Mastra API evolution is confined to one file, (3) the demo's
// deterministic path is auditable line-by-line.
// ─────────────────────────────────────────────────────────────────────────────
import type { DraftRunbook, FaultInput, RetrievedContext, ScoreCard } from '@/lib/types';
import { chat, parseJsonLoose, demoMode, healthCheckLLM } from '@/lib/llm';
import {
  RUNBOOK_SYSTEM, runbookUserPrompt,
  POSTMORTEM_SYSTEM, postMortemUserPrompt,
  HYPOTHESIS_REFINE_SYSTEM,
} from './prompts';
import { DraftRunbook as DraftRunbookSchema } from '@/lib/types';

// ── Context → prompt strings ─────────────────────────────────────────────────
export function contextToPromptBlocks(ctx: RetrievedContext): { incidents: string; oem: string; runbooks: string } {
  return {
    incidents: ctx.incidents.map((i, n) =>
      `[incident ${n + 1} | ${i.payload.equipment_id} @ ${i.payload.plant_id} | similarity ${(i.score * 100).toFixed(0)}%]\n` +
      `fault: ${i.payload.fault_description}\nroot cause: ${i.payload.root_cause}\nfix: ${i.payload.fix_applied} (${i.payload.time_to_resolve_minutes} min)`,
    ).join('\n\n') || 'none found',
    oem: ctx.manualChunks.map((m) =>
      `[${m.payload.manufacturer} manual ${m.payload.chapter} · ${m.payload.section_type} · p.${m.payload.page_range}]\n${m.payload.text}`,
    ).join('\n\n') || 'none found',
    runbooks: ctx.runbooks.map((r) =>
      `[${r.payload.title} | L${r.payload.skill_level_required} | ${r.payload.safety_rating}]\n${r.payload.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    ).join('\n\n') || 'none available at this authorisation level',
  };
}

function faultToText(fault: FaultInput): string {
  return `${fault.equipmentId} (${fault.equipmentType}) at plant ${fault.plantId} — code ${fault.faultCode}, severity ${fault.severity}, reported by ${fault.reportedBy}: ${fault.description}`;
}

// ── Draft runbook (FR-06) ────────────────────────────────────────────────────
// live mode → real LLM via provider chain; scripted mode OR LLM failure →
// deterministic generator derived from the retrieved vetted runbook.
export async function draftRunbookLogic(opts: {
  correlationId: string; runId?: string;
  fault: FaultInput; context: RetrievedContext;
  refineFeedback?: string[]; previous?: DraftRunbook;
}): Promise<{ runbook: DraftRunbook; source: 'live' | 'scripted'; fallbackReason?: string }> {
  const blocks = contextToPromptBlocks(opts.context);
  const isRefine = Boolean(opts.refineFeedback?.length && opts.previous);
  let fallbackReason: string | undefined;

  if (demoMode() === 'live') {
    await healthCheckLLM(); // one-time boot banner to stderr if the chain is down
    const outcome = await chat({
      system: isRefine ? HYPOTHESIS_REFINE_SYSTEM : RUNBOOK_SYSTEM,
      user: isRefine
        ? `FAILED DRAFT:\n${JSON.stringify(opts.previous)}\n\nSCORER REASONS:\n- ${opts.refineFeedback!.join('\n- ')}\n\nOEM EXTRACTS:\n${blocks.oem}`
        : runbookUserPrompt({ faultText: faultToText(opts.fault), ...blocks }),
      correlationId: opts.correlationId, runId: opts.runId,
      step: isRefine ? 'refine-runbook' : 'draft-runbook',
      json: true, temperature: 0.15, maxTokens: 1600,
    });
    if (outcome.ok) {
      const parsed = parseJsonLoose<unknown>(outcome.result.text);
      const valid = DraftRunbookSchema.safeParse(parsed);
      if (valid.success) return { runbook: valid.data, source: 'live' };
      fallbackReason = `LLM output failed schema validation (${outcome.result.model})`;
    } else {
      fallbackReason = outcome.status ? `LLM ${outcome.status}` : outcome.reason;
    }
    // LOUD (TASK 1.2): live was expected but we are degrading to the deterministic
    // drafter — must be impossible to miss on stage. Never dead-ends (NFR-04).
    const prov = outcome.ok ? outcome.result.provider : (outcome.provider ?? 'n/a');
    const model = outcome.ok ? outcome.result.model : (outcome.model ?? 'n/a');
    console.error(`\n[LLM-FALLBACK] ❌ DEMO_MODE=live but drafter FELL BACK — reason=${fallbackReason} · provider=${prov} · model=${model}  ->  FALLING BACK TO SCRIPTED\n`);
  }

  // TASK 2 (opt-in): DEMO_SHOW_REFINE=1 emits a genuinely deficient FIRST draft
  // (missing verifications) so the REAL completeness scorer fails attempt 1 and
  // the REAL self-refine loop produces the complete draft on attempt 2. The
  // refine call (isRefine) always yields the complete draft. OFF by default.
  const deficient = process.env.DEMO_SHOW_REFINE === '1' && !isRefine;
  return { runbook: scriptedRunbook(opts.fault, opts.context, { deficient }), source: 'scripted', fallbackReason };
}

// Deterministic generator. NOTE the deliberate fault injection: in scripted
// mode the first numeric torque spec is perturbed (45 → 80 Nm) so the Enkrypt
// safety-gate demonstration is reproducible on every demo run. This mirrors
// chaos-engineering practice — we prove the gate works by feeding it a known
// failure. Fully documented in docs/DEMO_SCRIPT.md; live mode has no injection.
export function scriptedRunbook(fault: FaultInput, ctx: RetrievedContext, opts?: { deficient?: boolean }): DraftRunbook {
  const vetted = ctx.runbooks[0]?.payload;
  const bestIncident = ctx.incidents[0]?.payload;
  const hypothesis = bestIncident
    ? `Pattern matches ${bestIncident.equipment_id} (${new Date(bestIncident.timestamp).toISOString().slice(0, 10)}): ${bestIncident.root_cause}`
    : `Most probable cause inferred from OEM diagnostics for ${fault.faultCode}.`;

  let steps = (vetted?.steps ?? [
    'Perform full LOTO per OEM isolation procedure (isolate, lock, vent to zero, test start).',
    'Inspect the affected assembly and confirm the fault signature per OEM diagnostics.',
    'Replace or correct the failed component per OEM manual, using specified torques verbatim.',
    'Restore locks in reverse order, run the asset, and verify parameters within OEM limits.',
    'Log readings and close out in CMMS.',
  ]).map((action, i) => ({
    n: i + 1,
    action,
    verification: i === 0 ? 'Zero energy proven by failed test-start' : 'Condition verified against OEM limits',
    ppe: i === 0 ? 'Safety glasses, cut-resistant gloves, boots, hearing protection' : undefined,
  }));

  // Scripted fault injection (see note above): perturb the first "45 Nm" → "80 Nm".
  let injected = false;
  steps = steps.map((s) => {
    if (!injected && /45\s*Nm/i.test(s.action)) {
      injected = true;
      return { ...s, action: s.action.replace(/45\s*Nm/i, '80 Nm') };
    }
    return s;
  });

  // TASK 2 (opt-in demo): a GENUINELY deficient first draft — strip the
  // verification criteria off the middle steps so scoreCompleteness legitimately
  // drops below the 0.75 threshold (weak/missing verification, −0.1 each). The
  // self-refine attempt (deficient=false) restores them; nothing is faked.
  if (opts?.deficient) {
    steps = steps.map((s, i) => (i >= 1 && i <= 3 ? { ...s, verification: '' } : s));
  }

  return {
    title: vetted ? `${vetted.title} — ${fault.equipmentId}` : `Corrective maintenance — ${fault.equipmentId} ${fault.faultCode}`,
    faultHypothesis: hypothesis,
    steps,
    estimatedMinutes: vetted?.estimated_minutes ?? 120,
  };
}

// ── Execution simulation (FR-08 boundary: nothing executes before approval) ──
export async function executeLogic(runbook: DraftRunbook): Promise<{ executedSteps: number; minutes: number }> {
  // Physical execution is performed by the human technician; Sentinel tracks
  // completion. The simulation returns a realistic elapsed time.
  const minutes = Math.max(20, Math.round(runbook.estimatedMinutes * (0.7 + Math.random() * 0.4)));
  return { executedSteps: runbook.steps.length, minutes };
}

// ── Post-mortem (FR-10) ──────────────────────────────────────────────────────
export async function postMortemLogic(opts: {
  correlationId: string; runId?: string;
  fault: FaultInput; runbook: DraftRunbook; minutes: number; notes: string;
}): Promise<{ text: string; source: 'live' | 'scripted' }> {
  if (demoMode() === 'live') {
    const outcome = await chat({
      system: POSTMORTEM_SYSTEM,
      user: postMortemUserPrompt({
        faultText: faultToText(opts.fault),
        runbookText: opts.runbook.steps.map((s) => `${s.n}. ${s.action}`).join('\n'),
        minutes: opts.minutes, notes: opts.notes,
      }),
      correlationId: opts.correlationId, runId: opts.runId,
      step: 'draft-postmortem', temperature: 0.2, maxTokens: 700,
    });
    if (outcome.ok && outcome.result.text.trim()) return { text: outcome.result.text.trim(), source: 'live' };
    const reason = outcome.ok ? 'empty response' : (outcome.status ? `LLM ${outcome.status}` : outcome.reason);
    console.error(`[LLM-FALLBACK] ❌ DEMO_MODE=live but post-mortem FELL BACK — reason=${reason}  ->  FALLING BACK TO SCRIPTED`);
  }
  const rb = opts.runbook;
  return {
    source: 'scripted',
    text: [
      'TIMELINE:',
      `- T+0 min — ${opts.fault.faultCode} raised on ${opts.fault.equipmentId} (${opts.fault.reportedBy})`,
      `- T+2 min — context retrieved; runbook drafted, scored, and safety-gated`,
      `- T+${Math.round(opts.minutes * 0.15)} min — technician approval received; work began under LOTO`,
      `- T+${opts.minutes} min — asset restored and verified within OEM limits`,
      'ROOT CAUSE:',
      rb.faultHypothesis,
      'FIX APPLIED:',
      rb.steps.map((s) => s.action).slice(1, 4).join(' → '),
      'WHAT WORKED:',
      'Institutional-memory match accelerated diagnosis; OEM cross-check prevented an out-of-spec torque.',
      'PREVENTION:',
      'Add torque-wrench verification to the sign-off checklist (owner: maintenance planner).',
    ].join('\n'),
  };
}
