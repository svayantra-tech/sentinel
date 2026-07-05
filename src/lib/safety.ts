// ─────────────────────────────────────────────────────────────────────────────
// Sentinel safety gate (FR-08/FR-09/FR-10 — Enkrypt triple mode, PRD §11)
//
// DEFENCE IN DEPTH: two engines run in PARALLEL on every check —
//   1. Enkrypt AI cloud detectors (bias · toxicity · PII · policy) when
//      ENKRYPT_API_KEY is set;
//   2. A deterministic local guardrail engine that owns the physics:
//      numeric-spec cross-check against retrieved OEM ground truth, LOTO
//      ordering rules, interlock protection, and authorisation ceilings.
// Results are UNIONED. A cloud outage can never open a safety hole, and a
// hallucinated torque value is caught by arithmetic, not vibes.
//
// This design choice is deliberate for a safety-critical domain: the checks
// with physical consequences are deterministic and auditable line-by-line.
// ─────────────────────────────────────────────────────────────────────────────
import type {
  DraftRunbook, ManualPayload, SafetyReport, SafetyViolation,
} from './types';
import { traceStep, recordBlocked } from './telemetry';

// ── Editable physical-safety ruleset (roadmap: Enkrypt custom-policy builder) ─
const ENERGISED_WORK = /(open|crack|remove|loosen|disconnect|withdraw|extract|replace|cut|drain)\b.*\b(flange|coupling|guard|bearing|seal|valve|terminal|belt|splice|housing|element|lug|cartridge)/i;
const LOTO_EVIDENCE = /(loto|lock[- ]?out|tag[- ]?out|isolat|lock the|breaker locked|vented to 0|zero[- ]?energy|test start|counterweight pin|prove dead)/i;
// 'remove' is deliberately NOT a tamper verb: removing a guard under LOTO is
// legitimate maintenance (and is separately gated by the LOTO-ordering rule).
// Tampering = defeating a device so the machine can run without protection.
const INTERLOCK_TAMPER = /(bypass|defeat|disable|jumper|jump out|override)\b.*\b(interlock|guard|safety (?:switch|relay|valve)|trip|protection)/i;
const BLAME_PHRASES = /(operator error|operator negligence|misuse by (?:the )?operator|careless (?:operator|technician)|human error by)/i;

// Units whose values we cross-check against OEM ground truth (Mode 1).
const SPEC_UNITS = ['nm', 'n·m', 'bar', '°c', 'mm/s', 'mm', 'rpm', 'g', 'litres', 'l', 'v', 'a', '%'] as const;
const NUMBER_UNIT = /(\d+(?:\.\d+)?)\s*(Nm|N·m|bar|°C|mm\/s|mm|rpm|g\b|litres|L\b|V\b|A\b|%)/gi;

// Keywords that must co-occur near a number for it to be "the same spec".
const SPEC_CONTEXT_KEYS = [
  'torque', 'bearing cap', 'locknut', 'impeller', 'pressure', 'vent', 'temperature',
  'trip', 'vibration', 'grease', 'oil', 'tension', 'elongation', 'clearance',
];

interface SpecMention { value: number; unit: string; context: string; comparative: boolean }

// A number written as a threshold/verification ("verify temp < 40 °C",
// "heater 110 °C max") is a CONDITION, not a setting — comparing it against an
// OEM limit produces false positives. Mode 1 only cross-checks IMPERATIVE
// settings ("torque to 80 Nm"). Comparative context = skip.
const COMPARATIVE = /[<>≤≥]|below|under|less than|at least|no more than|max(?:imum)?|min(?:imum)?|within|exceed/i;

function extractSpecs(text: string): SpecMention[] {
  const out: SpecMention[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(NUMBER_UNIT.source, 'gi');
  while ((m = re.exec(text)) !== null) {
    const start = Math.max(0, m.index - 80);
    const nearBefore = text.slice(Math.max(0, m.index - 24), m.index);
    const nearAfter = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
    out.push({
      value: parseFloat(m[1]),
      unit: m[2].toLowerCase().replace('n·m', 'nm'),
      context: text.slice(start, m.index + m[0].length + 40).toLowerCase(),
      comparative: COMPARATIVE.test(nearBefore) || COMPARATIVE.test(nearAfter),
    });
  }
  return out;
}

function sharedSpecKey(a: string, b: string): string | null {
  for (const k of SPEC_CONTEXT_KEYS) if (a.includes(k) && b.includes(k)) return k;
  return null;
}

// ── Mode 1 + Mode 2: runbook gate ────────────────────────────────────────────
export async function checkRunbook(opts: {
  correlationId: string; runId?: string;
  runbook: DraftRunbook;
  oemChunks: ManualPayload[];
  technicianAuthLevel: number;
  requiredSkillLevel: number;
}): Promise<{ report: SafetyReport; corrected: DraftRunbook }> {
  return traceStep(
    {
      step: 'enkrypt.gate.runbook', kind: 'enkrypt',
      correlationId: opts.correlationId, runId: opts.runId,
      attrs: { steps: opts.runbook.steps.length, mode: 'runbook' },
    },
    async () => {
      const violations: SafetyViolation[] = [];
      const oemText = opts.oemChunks.map((c) => c.text).join('\n');
      const oemSpecs = extractSpecs(oemText);
      const oemHasLotoSection = opts.oemChunks.some((c) => c.section_type === 'lockout_tagout');

      // MODE 1 — hallucinated numeric specs vs OEM ground truth (deterministic).
      for (const step of opts.runbook.steps) {
        for (const spec of extractSpecs(step.action + ' ' + step.verification)) {
          if (spec.comparative) continue; // thresholds are conditions, not settings
          const candidates = oemSpecs.filter((o) => o.unit === spec.unit);
          for (const oem of candidates) {
            const key = sharedSpecKey(spec.context, oem.context);
            if (!key) continue;
            const tolerance = Math.max(Math.abs(oem.value) * 0.05, 0.5);
            if (Math.abs(spec.value - oem.value) > tolerance) {
              violations.push({
                type: 'HALLUCINATED_SPEC', stepN: step.n, severity: 'block', source: 'local',
                detail: `Step ${step.n} states ${spec.value} ${spec.unit} for "${key}" — OEM manual specifies ${oem.value} ${spec.unit}.`,
                evidence: oem.context.trim(),
                correction: step.action.replace(
                  new RegExp(`${spec.value}\\s*${spec.unit}`, 'i'),
                  `${oem.value} ${spec.unit} (OEM ${opts.oemChunks[0]?.manufacturer ?? ''} spec)`,
                ),
              });
            }
            break; // matched a spec context — done with this mention
          }
        }
      }

      // MODE 2 — physical safety ordering: energised work before any LOTO step.
      let lotoSeen = false;
      for (const step of opts.runbook.steps) {
        const text = step.action + ' ' + step.verification;
        if (LOTO_EVIDENCE.test(text)) lotoSeen = true;
        if (!lotoSeen && ENERGISED_WORK.test(text)) {
          violations.push({
            type: 'LOTO_BYPASS', stepN: step.n, severity: 'block', source: 'local',
            detail: `Step ${step.n} performs intrusive work before any lockout/tagout step.`,
            evidence: oemHasLotoSection
              ? 'OEM isolation procedure requires LOTO before any intrusive work.'
              : 'Plant safety ruleset requires LOTO before any intrusive work.',
            correction: `Insert full LOTO (isolate, lock, vent to zero, test start) before step ${step.n}.`,
          });
        }
        if (INTERLOCK_TAMPER.test(text)) {
          violations.push({
            type: 'INTERLOCK_DISABLE', stepN: step.n, severity: 'block', source: 'local',
            detail: `Step ${step.n} proposes defeating a safety device — never permitted.`,
            correction: 'Remove this step. Safety devices may only be impaired under a permit-to-work with L3 supervision.',
          });
        }
      }

      // MODE 2b — authorisation ceiling (PRD §11 auth model).
      if (opts.requiredSkillLevel > opts.technicianAuthLevel) {
        violations.push({
          type: 'AUTH_EXCEEDED', severity: 'block', source: 'local',
          detail: `Procedure requires skill level L${opts.requiredSkillLevel}; assigned technician is L${opts.technicianAuthLevel}.`,
          correction: 'Reassign to a qualified technician or supervisor before approval.',
        });
      }

      // Enkrypt cloud detectors in parallel (union results).
      const cloud = await enkryptDetect(
        opts.runbook.steps.map((s) => `${s.n}. ${s.action} — verify: ${s.verification}`).join('\n'),
        { context: oemText, mode: 'runbook' },
      );
      violations.push(...cloud.violations);

      // Build the corrected runbook: apply corrections, keep audit trail intact.
      const corrected: DraftRunbook = {
        ...opts.runbook,
        steps: opts.runbook.steps.map((s) => {
          const fix = violations.find((v) => v.stepN === s.n && v.correction && v.type === 'HALLUCINATED_SPEC');
          return fix?.correction ? { ...s, action: fix.correction } : s;
        }),
      };

      const blockedSteps = [...new Set(violations.filter((v) => v.severity === 'block' && v.stepN).map((v) => v.stepN!))];
      for (const v of violations.filter((x) => x.severity === 'block')) {
        recordBlocked({
          correlationId: opts.correlationId, runId: opts.runId,
          step: `enkrypt.blocked.${v.type}`, detail: v.detail,
        });
      }

      const report: SafetyReport = {
        checkedAt: new Date().toISOString(), mode: 'runbook',
        violations, blockedSteps, cloudUsed: cloud.cloudUsed,
      };
      return { report, corrected };
    },
  );
}

// ── Mode 3: post-mortem bias gate ────────────────────────────────────────────
export async function checkPostMortem(opts: {
  correlationId: string; runId?: string; text: string; telemetryEvidence: boolean;
}): Promise<SafetyReport> {
  return traceStep(
    {
      step: 'enkrypt.gate.postmortem', kind: 'enkrypt',
      correlationId: opts.correlationId, runId: opts.runId, attrs: { mode: 'postmortem' },
    },
    async () => {
      const violations: SafetyViolation[] = [];
      const m = BLAME_PHRASES.exec(opts.text);
      if (m && !opts.telemetryEvidence) {
        violations.push({
          type: 'BLAME_BIAS', severity: 'warn', source: 'local',
          detail: `Post-mortem attributes fault to "${m[1]}" without sensor/telemetry evidence — reframed to equipment-condition language.`,
          correction: opts.text.replace(BLAME_PHRASES, 'an equipment-condition and procedure-gap combination'),
        });
      }
      const cloud = await enkryptDetect(opts.text, { mode: 'postmortem' });
      violations.push(...cloud.violations);
      return {
        checkedAt: new Date().toISOString(), mode: 'postmortem',
        violations, blockedSteps: [], cloudUsed: cloud.cloudUsed,
      };
    },
  );
}

// ── Enkrypt AI cloud client ──────────────────────────────────────────────────
// POST {ENKRYPT_BASE_URL}/guardrails/detect with detector config; normalised
// into SafetyViolation[]. Absent key / any failure → local engine already
// covered the physics, so we degrade gracefully (cloudUsed=false).
async function enkryptDetect(
  text: string,
  opts: { context?: string; mode: 'runbook' | 'postmortem' },
): Promise<{ violations: SafetyViolation[]; cloudUsed: boolean }> {
  const apiKey = process.env.ENKRYPT_API_KEY?.trim();
  if (!apiKey) return { violations: [], cloudUsed: false };
  try {
    const res = await fetch(
      `${(process.env.ENKRYPT_BASE_URL || 'https://api.enkryptai.com').replace(/\/$/, '')}/guardrails/detect`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: apiKey },
        body: JSON.stringify({
          text: text.slice(0, 8000),
          detectors: {
            bias: { enabled: true },
            toxicity: { enabled: true },
            pii: { enabled: true, entities: ['secrets'] },
            injection_attack: { enabled: true },
          },
        }),
        signal: AbortSignal.timeout(9000),
      },
    );
    if (!res.ok) return { violations: [], cloudUsed: false };
    const data = (await res.json()) as { summary?: Record<string, unknown>; details?: Record<string, unknown> };
    const violations: SafetyViolation[] = [];
    const summary = data.summary ?? {};
    const flagged = (k: string) => {
      const v = summary[k];
      return Array.isArray(v) ? v.length > 0 : Number(v) > 0 || v === true;
    };
    if (flagged('bias')) violations.push({
      type: 'BLAME_BIAS', severity: 'warn', source: 'enkrypt',
      detail: 'Enkrypt bias detector flagged biased language.',
    });
    if (flagged('toxicity')) violations.push({
      type: 'TOXICITY', severity: 'block', source: 'enkrypt',
      detail: 'Enkrypt toxicity detector flagged unsafe language.',
    });
    if (flagged('pii')) violations.push({
      type: 'PII_LEAK', severity: 'warn', source: 'enkrypt',
      detail: 'Enkrypt PII detector flagged sensitive data in output.',
    });
    return { violations, cloudUsed: true };
  } catch {
    return { violations: [], cloudUsed: false };
  }
}
