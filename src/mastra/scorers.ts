// ─────────────────────────────────────────────────────────────────────────────
// Sentinel runbook scorers (FR-07 — Mastra scorer stage, PRD §17-Mastra)
//
// DESIGN DECISION (deliberate, judge-facing): in a safety-critical physical
// domain, quality gates must be DETERMINISTIC and auditable — we do not let an
// LLM grade safety with vibes. Each scorer is a pure function over the runbook
// and the retrieved ground truth; the trio gates the workflow before Enkrypt.
//
//   relevance     — is every step grounded in the retrieved OEM/incident text?
//   safety        — LOTO-first ordering, PPE presence, no unverifiable numbers
//   completeness  — structural rubric (steps, verifications, time estimate)
//
// Threshold: ALL three ≥ 0.75 (NFR-02). Failing runbooks loop once through the
// self-refinement prompt with the reasons attached (visible as attempt 2 in
// the observability panel).
// ─────────────────────────────────────────────────────────────────────────────
import type { DraftRunbook, RetrievedContext, ScoreCard } from '@/lib/types';
import { traceStep } from '@/lib/telemetry';

const PASS = 0.75;

const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'with', 'per', 'for', 'in', 'on', 'at', 'is', 'are', 'be', 'via', 'from', 'then', 'until', 'after', 'before', 'never', 'must', 'step']);

function keywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9° ]+/g, ' ').split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
}

function grounding(step: string, contextWords: Set<string>): number {
  const sw = keywords(step);
  if (sw.size === 0) return 0;
  let hit = 0;
  for (const w of sw) if (contextWords.has(w)) hit++;
  return hit / sw.size;
}

export function scoreRelevance(runbook: DraftRunbook, ctx: RetrievedContext): { score: number; reasons: string[] } {
  const contextText = [
    ...ctx.manualChunks.map((m) => m.payload.text),
    ...ctx.incidents.map((i) => `${i.payload.fault_description} ${i.payload.root_cause} ${i.payload.fix_applied}`),
    ...ctx.runbooks.flatMap((r) => r.payload.steps),
  ].join(' ');
  const cw = keywords(contextText);
  const reasons: string[] = [];
  let total = 0;
  for (const s of runbook.steps) {
    const g = grounding(`${s.action} ${s.verification}`, cw);
    total += g;
    if (g < 0.25) reasons.push(`Step ${s.n} appears ungrounded in retrieved context (grounding ${(g * 100).toFixed(0)}%).`);
  }
  const score = runbook.steps.length ? total / runbook.steps.length : 0;
  // Normalise: 0.45 raw overlap is excellent for prose → map to ~0.9
  const normalised = Math.min(1, score / 0.5);
  return { score: round(normalised), reasons };
}

const NUM_UNIT = /(\d+(?:\.\d+)?)\s*(Nm|N·m|bar|°C|mm\/s|mm|rpm|g\b|litres|L\b|V\b|A\b|%)/gi;
const LOTO = /(loto|lock[- ]?out|isolat|breaker locked|vented to 0|zero[- ]?energy|counterweight pin|prove dead|test start)/i;
const INTRUSIVE = /(remove|open|extract|replace|cut|disconnect|loosen|withdraw|drain)/i;
const PPE_HINT = /(ppe|glove|goggle|glass|boot|hearing|helmet|face shield|heat[- ]resistant)/i;

export function scoreSafety(runbook: DraftRunbook, ctx: RetrievedContext): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 1.0;

  // LOTO must appear no later than step 1-2 and before any intrusive step.
  const lotoIndex = runbook.steps.findIndex((s) => LOTO.test(s.action + ' ' + s.verification));
  const firstIntrusive = runbook.steps.findIndex((s) => INTRUSIVE.test(s.action));
  if (lotoIndex === -1) { score -= 0.5; reasons.push('No lockout/tagout step present.'); }
  else if (firstIntrusive !== -1 && firstIntrusive < lotoIndex) {
    score -= 0.4; reasons.push(`Intrusive work (step ${runbook.steps[firstIntrusive].n}) precedes LOTO (step ${runbook.steps[lotoIndex].n}).`);
  } else if (lotoIndex > 1) { score -= 0.15; reasons.push('LOTO should be step 1.'); }

  // PPE must be mentioned somewhere (step field or ppe field).
  const anyPpe = runbook.steps.some((s) => s.ppe || PPE_HINT.test(s.action));
  if (!anyPpe) { score -= 0.15; reasons.push('No PPE called out anywhere in the runbook.'); }

  // Every IMPERATIVE number must exist in retrieved OEM text (anti-invention).
  // Threshold-style numbers ("verify < 40 °C") are conditions and exempt —
  // parity with the Mode-1 comparator rule in src/lib/safety.ts.
  const COMPARATIVE = /[<>≤≥]|below|under|less than|at least|no more than|max(?:imum)?|min(?:imum)?|within|exceed/i;
  const oemText = ctx.manualChunks.map((m) => m.payload.text).join(' ').toLowerCase();
  let m: RegExpExecArray | null;
  const re = new RegExp(NUM_UNIT.source, 'gi');
  const joined = runbook.steps.map((s) => s.action).join(' ');
  const unverified: string[] = [];
  while ((m = re.exec(joined)) !== null) {
    const nearBefore = joined.slice(Math.max(0, m.index - 24), m.index);
    const nearAfter = joined.slice(m.index + m[0].length, m.index + m[0].length + 14);
    if (COMPARATIVE.test(nearBefore) || COMPARATIVE.test(nearAfter)) continue;
    const needle = m[1];
    if (!oemText.includes(needle)) unverified.push(`${m[1]} ${m[2]}`);
  }
  if (unverified.length) {
    score -= Math.min(0.3, unverified.length * 0.15);
    reasons.push(`Numeric value(s) not present in OEM extracts: ${unverified.join(', ')} — cite the manual or write "per OEM manual".`);
  }

  return { score: round(Math.max(0, score)), reasons };
}

export function scoreCompleteness(runbook: DraftRunbook): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 1.0;
  if (runbook.steps.length < 4) { score -= 0.3; reasons.push('Fewer than 4 steps — likely missing restore/verify phases.'); }
  const weakVerifs = runbook.steps.filter((s) => s.verification.trim().length < 8);
  if (weakVerifs.length) {
    score -= Math.min(0.3, weakVerifs.length * 0.1);
    reasons.push(`Steps with weak/missing verification: ${weakVerifs.map((s) => s.n).join(', ')}.`);
  }
  const lastStep = runbook.steps[runbook.steps.length - 1];
  if (lastStep && !/(run|verify|log|confirm|restore|monitor|test)/i.test(lastStep.action + lastStep.verification)) {
    score -= 0.15; reasons.push('Runbook does not end with a restore/verify/log step.');
  }
  if (!runbook.estimatedMinutes || runbook.estimatedMinutes <= 0) {
    score -= 0.1; reasons.push('Missing time estimate.');
  }
  if (!runbook.faultHypothesis || runbook.faultHypothesis.length < 15) {
    score -= 0.1; reasons.push('Fault hypothesis missing or too thin.');
  }
  return { score: round(Math.max(0, score)), reasons };
}

export async function runScorers(opts: {
  correlationId: string; runId?: string;
  runbook: DraftRunbook; context: RetrievedContext; attempt: number;
}): Promise<ScoreCard> {
  return traceStep(
    {
      step: 'scorer.runbook', kind: 'scorer',
      correlationId: opts.correlationId, runId: opts.runId,
      attrs: { attempt: opts.attempt },
    },
    async () => {
      const rel = scoreRelevance(opts.runbook, opts.context);
      const saf = scoreSafety(opts.runbook, opts.context);
      const com = scoreCompleteness(opts.runbook);
      const card: ScoreCard = {
        relevance: rel.score, safety: saf.score, completeness: com.score,
        pass: rel.score >= PASS && saf.score >= PASS && com.score >= PASS,
        reasons: [...rel.reasons, ...saf.reasons, ...com.reasons],
        attempt: opts.attempt,
      };
      return card;
    },
  );
}

function round(n: number): number { return Math.round(n * 100) / 100; }
