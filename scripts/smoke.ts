// ─────────────────────────────────────────────────────────────────────────────
// Sentinel smoke test — validates the agent BRAIN end-to-end without the web
// server: retrieval filters, scorer gates, the Enkrypt safety catch (80→45 Nm),
// LOTO ordering, auth ceilings, bias gate, and the memory flywheel.
// Maps to acceptance criteria in docs/PRD.md (run: npm run smoke).
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert';
import { seedAll, retrieveContext, writeBackIncident } from '../src/lib/memory';
import { buildIncidentCorpus, OEM_MANUALS, RUNBOOK_LIBRARY } from '../src/data/seed-corpus';
import { scriptedRunbook, postMortemLogic } from '../src/mastra/logic';
import { runScorers } from '../src/mastra/scorers';
import { checkRunbook, checkPostMortem } from '../src/lib/safety';
import type { FaultInput } from '../src/lib/types';

process.env.DEMO_MODE = 'scripted';

const FAULT: FaultInput = {
  equipmentId: 'PUMP-7', equipmentType: 'centrifugal_pump', plantId: 'IN-04',
  faultCode: 'VIB-201', severity: 'high', reportedBy: 'sensor',
  description: 'High radial vibration 9.1 mm/s RMS on drive-end bearing, trending up over 48 h.',
};
const cid = 'smoke-test';

async function main() {
  let passed = 0;
  const ok = (name: string) => { passed++; console.log(`  ✓ ${name}`); };

  console.log('\n[1/6] Seeding corpus…');
  const seeded = await seedAll({ incidents: buildIncidentCorpus(), manuals: OEM_MANUALS, runbooks: RUNBOOK_LIBRARY });
  // 15-year corpus: ~3,000 incidents across the full fleet (see scripts/history-check.ts).
  assert(seeded.counts.incident_history >= 2500 && seeded.counts.incident_history <= 3400, `expected ~3000 incidents, got ${seeded.counts.incident_history}`);
  assert(seeded.counts.oem_manuals >= 20, `expected ≥20 OEM chunks, got ${seeded.counts.oem_manuals}`);
  ok(`corpus seeded (${seeded.backend}): ${seeded.counts.incident_history} incidents · ${seeded.counts.oem_manuals} OEM chunks · ${seeded.counts.runbook_library} runbooks`);

  console.log('\n[2/6] Qdrant-style retrieval with hard filters…');
  const ctx = await retrieveContext({
    correlationId: cid, equipmentType: FAULT.equipmentType, plantId: FAULT.plantId,
    faultText: `${FAULT.faultCode} ${FAULT.description}`, authLevel: 2,
  });
  assert(ctx.incidents.length === 3, 'expected top-3 incidents');
  assert(ctx.incidents.every((i) => i.payload.equipment_type === 'centrifugal_pump'), 'equipment_type filter leak!');
  assert(ctx.incidents[0].payload.fault_code.startsWith('VIB'), 'semantic match should surface vibration incidents first');
  ok('top-3 incidents, all filtered to centrifugal_pump, vibration incidents ranked first');
  assert(ctx.manualChunks.some((m) => m.payload.section_type === 'lockout_tagout'), 'LOTO chunk must be force-included');
  ok('LOTO manual section force-included in context (safety-first retrieval)');
  const ctxL1 = await retrieveContext({
    correlationId: cid, equipmentType: FAULT.equipmentType, plantId: FAULT.plantId,
    faultText: 'bearing replacement', authLevel: 1,
  });
  assert(ctxL1.runbooks.every((r) => r.payload.skill_level_required <= 1), 'auth-level filter leak!');
  ok('auth-level filter: L1 technician cannot retrieve L2 danger-rated runbooks');

  console.log('\n[3/6] Scripted draft (fault injection) + Enkrypt safety gate…');
  const draft = scriptedRunbook(FAULT, ctx);
  assert(draft.steps.some((s) => /80\s*Nm/i.test(s.action)), 'scripted mode must inject the 80 Nm hallucination');
  ok('fault-injected draft contains hallucinated "80 Nm" (chaos-engineering seed)');
  const gate = await checkRunbook({
    correlationId: cid, runbook: draft, oemChunks: ctx.manualChunks.map((m) => m.payload),
    technicianAuthLevel: 2, requiredSkillLevel: 2,
  });
  const hall = gate.report.violations.find((v) => v.type === 'HALLUCINATED_SPEC');
  assert(hall, 'safety gate MUST catch the 80 Nm vs 45 Nm spec hallucination');
  assert(/45/.test(hall!.detail), 'violation must cite the OEM 45 Nm ground truth');
  assert(gate.corrected.steps.some((s) => /45\s*Nm/i.test(s.action)), 'corrected runbook must restore 45 Nm');
  ok(`⛔ HALLUCINATED_SPEC caught & corrected: "${hall!.detail.slice(0, 90)}…"`);
  const blockTypes = [...new Set(gate.report.violations.filter((v) => v.severity === 'block').map((v) => v.type))];
  assert.deepStrictEqual(blockTypes, ['HALLUCINATED_SPEC'], `demo draft must yield exactly one block type, got ${blockTypes.join(',')}`);
  ok('no false-positive blocks on the demo runbook (guard removal under LOTO is legitimate)');

  // Craft a genuinely isolation-free runbook (strip ALL LOTO vocabulary — a
  // step referencing "zero-energy proof" legitimately counts as evidence).
  const lotoBad = { ...draft, steps: draft.steps.filter((s) => !/loto|lock|zero[- ]?energy|isolat/i.test(s.action)).map((s, i) => ({ ...s, n: i + 1 })) };
  const gate2 = await checkRunbook({
    correlationId: cid, runbook: lotoBad, oemChunks: ctx.manualChunks.map((m) => m.payload),
    technicianAuthLevel: 2, requiredSkillLevel: 2,
  });
  assert(gate2.report.violations.some((v) => v.type === 'LOTO_BYPASS'), 'must catch intrusive work without LOTO');
  ok('⛔ LOTO_BYPASS caught when isolation step removed');

  const gate3 = await checkRunbook({
    correlationId: cid, runbook: draft, oemChunks: ctx.manualChunks.map((m) => m.payload),
    technicianAuthLevel: 1, requiredSkillLevel: 2,
  });
  assert(gate3.report.violations.some((v) => v.type === 'AUTH_EXCEEDED'), 'must catch auth ceiling breach');
  ok('⛔ AUTH_EXCEEDED caught for L1 technician on L2 procedure');

  console.log('\n[4/6] Mastra scorers on the corrected runbook…');
  const card = await runScorers({ correlationId: cid, runbook: gate.corrected, context: ctx, attempt: 1 });
  assert(card.relevance >= 0.75, `relevance ${card.relevance} < 0.75`);
  assert(card.safety >= 0.75, `safety ${card.safety} < 0.75`);
  assert(card.completeness >= 0.75, `completeness ${card.completeness} < 0.75`);
  assert(card.pass, 'corrected runbook must pass all scorers');
  ok(`scorecard PASS — relevance ${card.relevance} · safety ${card.safety} · completeness ${card.completeness}`);

  console.log('\n[5/6] Post-mortem + bias gate…');
  const pm = await postMortemLogic({ correlationId: cid, fault: FAULT, runbook: gate.corrected, minutes: 96, notes: '' });
  assert(pm.text.includes('ROOT CAUSE'), 'post-mortem must contain the five sections');
  const biased = 'ROOT CAUSE:\nThe failure was caused by operator error during startup.';
  const pmGate = await checkPostMortem({ correlationId: cid, text: biased, telemetryEvidence: false });
  assert(pmGate.violations.some((v) => v.type === 'BLAME_BIAS'), 'bias gate must flag unevidenced operator blame');
  ok('BLAME_BIAS flagged on unevidenced "operator error" and reframed');

  console.log('\n[6/6] Memory flywheel — write-back then re-retrieve…');
  await writeBackIncident({
    correlationId: cid,
    incident: {
      kind: 'incident', equipment_id: FAULT.equipmentId, equipment_type: FAULT.equipmentType,
      plant_id: FAULT.plantId, fault_code: FAULT.faultCode, fault_description: FAULT.description,
      root_cause: gate.corrected.faultHypothesis, fix_applied: 'Bearing replaced, cap torqued 45 Nm per OEM.',
      time_to_resolve_minutes: 96, severity: FAULT.severity, outcome: 'resolved',
      technician_id: 'T-0871', timestamp: new Date().toISOString(),
    },
  });
  const ctx2 = await retrieveContext({
    correlationId: cid, equipmentType: FAULT.equipmentType, plantId: FAULT.plantId,
    faultText: `${FAULT.faultCode} ${FAULT.description}`, authLevel: 2,
  });
  assert(
    ctx2.incidents.some((i) => i.payload.fix_applied.includes('45 Nm per OEM')),
    'the just-resolved incident must surface in the next retrieval',
  );
  ok('flywheel verified: the incident we just resolved now informs the next run');

  console.log(`\n━━━ SMOKE PASSED — ${passed} assertions green ━━━\n`);
}

main().catch((e) => { console.error('\n✗ SMOKE FAILED:', e.message ?? e); process.exit(1); });
