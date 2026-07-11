// ─────────────────────────────────────────────────────────────────────────────
// Three-scenario integrity check — runs the three demo fault presets through
// the REAL Mastra workflow (scripted mode, isolated file DB) and asserts each
// produces a DIFFERENT retrieved context and a DIFFERENT safety verdict:
//   VIB-201 (pump)      → HALLUCINATED_SPEC  (torque 80→45 Nm, Mode 1)
//   HT-310  (compressor)→ INTERLOCK_DISABLE  (trip bypass, Mode 2)
//   TRK-155 (conveyor)  → LOTO_BYPASS        (isolation dropped, Mode 2)
// Run: npx tsx scripts/scenarios.ts
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert';

process.env.DEMO_MODE = 'scripted';
process.env.MASTRA_DB_URL = 'file:./scenarios-test.db';

const PRESETS = [
  { equipmentId: 'PUMP-7', equipmentType: 'centrifugal_pump' as const, plantId: 'IN-04', faultCode: 'VIB-201', severity: 'high' as const, reportedBy: 'sensor' as const, description: 'High radial vibration 9.1 mm/s RMS on drive-end bearing, trending up over 48 h.', expect: 'HALLUCINATED_SPEC' },
  { equipmentId: 'COMP-2', equipmentType: 'compressor' as const, plantId: 'IN-04', faultCode: 'HT-310', severity: 'high' as const, reportedBy: 'sensor' as const, description: 'Discharge temperature 111 °C trip within 25 minutes of loaded run; ambient 39 °C.', expect: 'INTERLOCK_DISABLE' },
  { equipmentId: 'CONV-1', equipmentType: 'conveyor' as const, plantId: 'IN-04', faultCode: 'TRK-155', severity: 'medium' as const, reportedBy: 'operator' as const, description: 'Belt drifting hard left at the tail pulley, edge fraying visible.', expect: 'LOTO_BYPASS' },
];

async function main() {
  const { startSentinelRun } = await import('../src/mastra');
  const { getRun } = await import('../src/lib/run-registry');

  const results: Array<{ fault: string; blockedTypes: string[]; incidents: string[]; runbook: string }> = [];
  for (const p of PRESETS) {
    const { expect, ...fault } = p;
    const { runId } = await startSentinelRun(fault, { sub: 'T-0871', name: 'Priya', role: 'technician', authLevel: 2 });
    let view: ReturnType<typeof getRun> extends infer R ? (R extends { view: infer V } ? V : never) | undefined : never;
    for (let i = 0; i < 300; i++) {
      const v = getRun(runId)?.view;
      if (v && (v.stage === 'SUSPENDED' || v.stage === 'FAILED' || v.stage === 'DONE')) { view = v; break; }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(view, `${p.faultCode}: no terminal view`);
    assert(view!.stage === 'SUSPENDED', `${p.faultCode}: expected SUSPENDED, got ${view!.stage}`);
    const blockedTypes: string[] = (view!.safety?.violations ?? []).filter((v) => v.severity === 'block').map((v) => v.type);
    const incidents = (view!.context?.incidents ?? []).map((i) => `${i.payload.equipment_id}:${i.payload.fault_code ?? i.payload.root_cause.slice(0, 30)}`);
    results.push({ fault: p.faultCode, blockedTypes, incidents, runbook: view!.runbook?.title ?? '?' });

    assert(blockedTypes.includes(p.expect), `${p.faultCode}: expected block ${p.expect}, got [${blockedTypes.join(',') || 'none'}]`);
    const blockedLocal = (view!.safety?.violations ?? []).filter((v) => v.severity === 'block');
    assert(blockedLocal.every((v) => v.source === 'local'), `${p.faultCode}: injected catches must be source=local (deterministic)`);

    // Corrected-runbook integrity — the runbook that reaches approval must be
    // ACTUALLY safe (this is the point; FAIL if a dangerous step survives).
    const corrected = view!.correctedRunbook;
    const draft = view!.runbook;
    assert(corrected && draft, `${p.faultCode}: corrected/draft runbook missing`);
    const cSteps = corrected!.steps.map((s) => s.action);
    // No interlock-tamper step may survive in ANY scenario's corrected runbook.
    assert(!cSteps.some((a) => /(bypass|defeat|disable|jumper|jump out|override)\b.*\b(interlock|guard|safety (?:switch|relay|valve)|trip|protection)/i.test(a)),
      `${p.faultCode}: an interlock-tamper step SURVIVED into the corrected runbook`);
    if (p.expect === 'HALLUCINATED_SPEC') {
      assert(!cSteps.some((a) => /80\s*nm/i.test(a)), `${p.faultCode}: hallucinated 80 Nm survived`);
      assert(cSteps.some((a) => /45\s*nm/i.test(a)), `${p.faultCode}: OEM 45 Nm not substituted`);
    }
    if (p.expect === 'INTERLOCK_DISABLE') {
      assert(corrected!.steps.length === draft!.steps.length - 1,
        `${p.faultCode}: tamper step not DROPPED (${draft!.steps.length} → ${corrected!.steps.length})`);
    }
    if (p.expect === 'LOTO_BYPASS') {
      assert(/loto|lock[- ]?out|isolat/i.test(cSteps[0]), `${p.faultCode}: corrected runbook does not START with LOTO`);
      assert(corrected!.steps.length === draft!.steps.length + 1,
        `${p.faultCode}: LOTO step not PREPENDED (${draft!.steps.length} → ${corrected!.steps.length})`);
    }
    assert(corrected!.steps.every((s, i) => s.n === i + 1), `${p.faultCode}: corrected steps not renumbered sequentially`);
    console.log(`  ✓ ${p.faultCode} (${p.equipmentType}) → ⛔ ${blockedTypes.join(', ')} · corrected runbook SAFE (${draft!.steps.length}→${corrected!.steps.length} steps)`);
  }

  // Distinctness: different verdicts, different runbooks, different retrievals.
  const verdicts = results.map((r) => r.blockedTypes.sort().join('+'));
  assert(new Set(verdicts).size === 3, `verdicts not distinct: ${verdicts.join(' | ')}`);
  const runbooks = new Set(results.map((r) => r.runbook));
  assert(runbooks.size === 3, `runbooks not distinct: ${[...runbooks].join(' | ')}`);
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const overlap = results[i].incidents.filter((x) => results[j].incidents.includes(x));
      assert(overlap.length === 0, `retrieved incidents overlap between ${results[i].fault} and ${results[j].fault}: ${overlap.join(',')}`);
    }
  }
  console.log('\n━━━ SCENARIOS PASSED — three distinct real catches, three distinct retrievals ━━━');
  process.exit(0);
}
main().catch((e) => { console.error('✗', e.message ?? e); process.exit(1); });
