// Two-process cold-resume test — reproduces the Vercel serverless resume failure
// locally. Process A starts a run (suspends, persists to a shared FILE db, exits).
// Process B is a FRESH process (no in-memory handle) that resumes from the
// persisted snapshot — exactly the serverless cross-instance path.
//
//   npx tsx --env-file=.env.local scripts/resume-test.ts start
//   npx tsx --env-file=.env.local scripts/resume-test.ts resume <runId>
process.env.DEMO_MODE = 'scripted';
process.env.MASTRA_DB_URL = 'file:./resume-test.db';   // shared durable store, no Turso
delete process.env.MASTRA_DB_AUTH_TOKEN;

async function main() {
  const mode = process.argv[2];
  const { startSentinelRun, resumeSentinelRun, getRunView } = await import('../src/mastra');
  const { getRun } = await import('../src/lib/run-registry');

  if (mode === 'start') {
    const { runId } = await startSentinelRun(
      { equipmentId: 'PUMP-7', equipmentType: 'centrifugal_pump', plantId: 'IN-04',
        faultCode: 'VIB-201', severity: 'high', reportedBy: 'sensor',
        description: 'High radial vibration 9.1 mm/s RMS on drive-end bearing, growl at 1x-3x RPM.' },
      { sub: 'T-0871', name: 'Priya', role: 'technician', authLevel: 2 },
    );
    let stage = '';
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      stage = getRun(runId)?.view.stage ?? '';
      if (stage === 'SUSPENDED' || stage === 'FAILED' || stage === 'DONE') break;
    }
    console.log(`START_RESULT runId=${runId} stage=${stage}`);
    process.exit(0);
  }

  if (mode === 'resume') {
    const runId = process.argv[3];
    console.log(`[resume proc] cold resume of ${runId} (in-memory handle absent)`);
    const res = await resumeSentinelRun(runId, { approved: true, technicianId: 'T-0871', notes: 'cold-resume test' });
    console.log('RESUME_CALL', JSON.stringify(res));
    let stage = '';
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const v = await getRunView(runId);
      stage = v?.stage ?? '';
      if (stage === 'DONE' || stage === 'FAILED') break;
    }
    const v = await getRunView(runId);
    console.log(`RESUME_RESULT stage=${stage} memoryPoint=${v?.memoryPointId ?? 'none'}`);
    const failNote = v?.timeline.find((t) => t.stage === 'FAILED');
    if (failNote) console.log('FAIL_NOTE', failNote.note);
    process.exit(0);
  }

  console.log('usage: resume-test.ts start | resume <runId>');
  process.exit(1);
}
main().catch((e) => { console.error('THREW', e); process.exit(1); });
