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
    const blockedTypes = (view!.safety?.violations ?? []).filter((v) => v.severity === 'block').map((v) => v.type);
    const incidents = (view!.context?.incidents ?? []).map((i) => `${i.payload.equipment_id}:${i.payload.fault_code ?? i.payload.root_cause.slice(0, 30)}`);
    results.push({ fault: p.faultCode, blockedTypes, incidents, runbook: view!.runbook?.title ?? '?' });

    assert(blockedTypes.includes(p.expect), `${p.faultCode}: expected block ${p.expect}, got [${blockedTypes.join(',') || 'none'}]`);
    const blockedLocal = (view!.safety?.violations ?? []).filter((v) => v.severity === 'block');
    assert(blockedLocal.every((v) => v.source === 'local'), `${p.faultCode}: injected catches must be source=local (deterministic)`);
    console.log(`  ✓ ${p.faultCode} (${p.equipmentType}) → ⛔ ${blockedTypes.join(', ')} · runbook "${results[results.length - 1].runbook}"`);
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
