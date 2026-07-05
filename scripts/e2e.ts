// ─────────────────────────────────────────────────────────────────────────────
// End-to-end Mastra workflow test — exercises the REAL Mastra 1.x runtime:
// createRun → start (halts SUSPENDED at the HITL gate) → resume → DONE,
// with LibSQL persistence, MCP work orders, and the memory flywheel.
// Run: npx tsx scripts/e2e.ts
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert';

process.env.DEMO_MODE = 'scripted';
process.env.MASTRA_DB_URL = 'file:./e2e-test.db';

async function main() {
  const { startSentinelRun } = await import('../src/mastra');
  const { getRun } = await import('../src/lib/run-registry');

  console.log('\n[e2e] starting Sentinel run through the REAL Mastra workflow…');
  const { runId, correlationId } = await startSentinelRun(
    {
      equipmentId: 'PUMP-7', equipmentType: 'centrifugal_pump', plantId: 'IN-04',
      faultCode: 'VIB-201', severity: 'high', reportedBy: 'sensor',
      description: 'High radial vibration 9.1 mm/s RMS on drive-end bearing, trending up over 48 h.',
    },
    { sub: 'T-0871', name: 'Priya', role: 'technician', authLevel: 2 },
  );
  console.log(`  runId=${runId} correlation=${correlationId}`);

  // Poll until the workflow suspends at the HITL gate.
  let stage = '';
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    stage = getRun(runId)?.view.stage ?? '';
    if (stage === 'SUSPENDED' || stage === 'FAILED' || stage === 'DONE') break;
  }
  const mid = getRun(runId)!.view;
  assert(stage === 'SUSPENDED', `expected SUSPENDED, got ${stage} — timeline: ${JSON.stringify(mid.timeline, null, 1)}`);
  assert(mid.workOrderId, 'MCP work order must exist');
  assert(mid.context && mid.context.incidents.length === 3, 'context retrieved');
  assert(mid.safety && mid.safety.violations.some((v) => v.type === 'HALLUCINATED_SPEC'), 'safety gate fired');
  assert(mid.correctedRunbook!.steps.some((s) => /45\s*Nm/i.test(s.action)), 'corrected to 45 Nm');
  console.log(`  ✓ SUSPENDED at HITL gate — WO ${mid.workOrderId}, ⛔ ${mid.safety!.violations.filter(v=>v.severity==='block').length} blocked, runbook corrected`);

  console.log('[e2e] resuming with technician approval…');
  const { resumeSentinelRun } = await import('../src/mastra');
  const res = await resumeSentinelRun(runId, { approved: true, technicianId: 'T-0871', notes: 'Torque wrench verified.' });
  assert(res.ok, `resume failed: ${res.error}`);

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    stage = getRun(runId)?.view.stage ?? '';
    if (stage === 'DONE' || stage === 'FAILED') break;
  }
  const fin = getRun(runId)!.view;
  assert(stage === 'DONE', `expected DONE, got ${stage} — timeline: ${JSON.stringify(fin.timeline, null, 1)}`);
  assert(fin.approval?.approved === true, 'approval recorded');
  assert(fin.postMortem?.includes('ROOT CAUSE'), 'post-mortem written');
  assert(fin.memoryPointId, 'incident written back to memory');
  console.log(`  ✓ DONE — post-mortem written, memory point ${fin.memoryPointId!.slice(0, 8)}…`);
  console.log(`  ✓ full timeline: ${fin.timeline.map((t) => t.stage).join(' → ')}`);

  console.log('\n━━━ E2E PASSED — real Mastra suspend/resume verified ━━━\n');
  process.exit(0);
}
main().catch((e) => { console.error('\n✗ E2E FAILED:', e.message ?? e); process.exit(1); });
