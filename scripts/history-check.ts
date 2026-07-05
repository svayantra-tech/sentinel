// ─────────────────────────────────────────────────────────────────────────────
// Sentinel history check (PART E) — turns "the flywheel works" from a claim into
// a test. Generates the deterministic 15-year corpus and asserts:
//   · ~3,000 incidents across ~60 assets and 5 plants,
//   · avg MTTR in the last 3 years is MATERIALLY lower than the first 3 years,
//   · repeat-failures-per-active-asset DECLINED post-2014 (memory matured),
//   · every record validates against the IncidentPayload shape and retrieves.
// Run: npm run history:check
// ─────────────────────────────────────────────────────────────────────────────
import assert from 'node:assert';
import { z } from 'zod';
import { buildFullHistory } from '../src/data/seed-corpus';
import { ASSETS, PLANTS } from '../src/data/history';
import { EquipmentType } from '../src/lib/types';
import { seedAll, retrieveContext } from '../src/lib/memory';
import { buildIncidentCorpus, OEM_MANUALS, RUNBOOK_LIBRARY } from '../src/data/seed-corpus';

const IncidentSchema = z.object({
  kind: z.literal('incident'),
  equipment_id: z.string().min(2),
  equipment_type: EquipmentType,
  plant_id: z.string().min(2),
  fault_code: z.string().min(2),
  fault_description: z.string().min(5),
  root_cause: z.string().min(3),
  fix_applied: z.string().min(3),
  time_to_resolve_minutes: z.number().int().positive(),
  severity: z.enum(['critical', 'high', 'medium']),
  outcome: z.enum(['resolved', 'escalated']),
  technician_id: z.string().min(2),
  timestamp: z.string().datetime(),
});

const yearOf = (iso: string) => Number(iso.slice(0, 4));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function main() {
  let passed = 0;
  const ok = (m: string) => { passed++; console.log(`  ✓ ${m}`); };

  const full = buildFullHistory();
  const incidents = full.map((h) => h.payload);
  console.log(`\n[1/5] Corpus scale`);
  console.log(`  incidents=${incidents.length}  assets=${ASSETS.length}  plants=${PLANTS.length}`);
  assert(incidents.length >= 2500 && incidents.length <= 3400, `expected ~3000 incidents, got ${incidents.length}`);
  const assetIds = new Set(incidents.map((i) => i.equipment_id));
  assert(assetIds.size >= 50, `expected ≥50 distinct assets in incidents, got ${assetIds.size}`);
  const plantIds = new Set(incidents.map((i) => i.plant_id));
  assert(plantIds.size === 5, `expected 5 plants, got ${plantIds.size}`);
  ok(`~3,000 incidents (${incidents.length}) across ${assetIds.size} assets and ${plantIds.size} plants`);

  console.log(`\n[2/5] Schema validity`);
  for (const inc of incidents) {
    const r = IncidentSchema.safeParse(inc);
    if (!r.success) throw new Error(`IncidentPayload invalid: ${r.error.issues[0].message} — ${JSON.stringify(inc)}`);
  }
  ok(`every one of ${incidents.length} incidents validates against the IncidentPayload shape`);

  console.log(`\n[3/5] ⭐ Flywheel — MTTR trends down`);
  const mttrIn = (years: number[]) => mean(incidents.filter((i) => years.includes(yearOf(i.timestamp))).map((i) => i.time_to_resolve_minutes));
  const first3 = mttrIn([2011, 2012, 2013]);
  const last3 = mttrIn([2023, 2024, 2025]);
  console.log(`  avg MTTR 2011-2013 = ${first3.toFixed(1)} min   ·   2023-2025 = ${last3.toFixed(1)} min   (${(100 * (1 - last3 / first3)).toFixed(1)}% faster)`);
  assert(last3 < first3 * 0.8, `last-3-year MTTR (${last3.toFixed(1)}) must be materially below first-3-year (${first3.toFixed(1)})`);
  ok(`mean MTTR fell from ${first3.toFixed(0)} min (2011-13) to ${last3.toFixed(0)} min (2023-25) — every fault makes the plant faster`);

  console.log(`\n[4/5] ⭐ Flywheel — repeat failures decline`);
  // A "repeat" = any incident that is NOT the first occurrence of that
  // asset+faultCode. Normalise by the number of assets active (installed) in the
  // year so a growing fleet does not mask the per-asset decline.
  const seen = new Set<string>();
  const repeatsByYear = new Map<number, number>();
  for (const inc of [...incidents].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const key = `${inc.equipment_id}|${inc.fault_code}`;
    const y = yearOf(inc.timestamp);
    if (seen.has(key)) repeatsByYear.set(y, (repeatsByYear.get(y) ?? 0) + 1);
    seen.add(key);
  }
  const activeAssets = (year: number) => ASSETS.filter((a) => yearOf(a.installDate) <= year).length;
  const rpa = (years: number[]) => mean(years.map((y) => (repeatsByYear.get(y) ?? 0) / activeAssets(y)));
  const rpaEarly = rpa([2012, 2013, 2014]);
  const rpaLate = rpa([2023, 2024, 2025]);
  console.log(`  repeats/active-asset 2012-2014 = ${rpaEarly.toFixed(3)}   ·   2023-2025 = ${rpaLate.toFixed(3)}`);
  assert(rpaLate < rpaEarly, `post-2014 repeats/asset (${rpaLate.toFixed(3)}) must be below 2012-2014 (${rpaEarly.toFixed(3)})`);
  ok(`repeat-failures per active asset fell from ${rpaEarly.toFixed(2)} to ${rpaLate.toFixed(2)} — the plant stops making the same mistake`);

  console.log(`\n[5/5] Retrieves cleanly`);
  await seedAll({ incidents: buildIncidentCorpus(), manuals: OEM_MANUALS, runbooks: RUNBOOK_LIBRARY });
  const ctx = await retrieveContext({
    correlationId: 'history-check', equipmentType: 'centrifugal_pump', plantId: 'IN-04',
    faultText: 'VIB-201 High radial vibration on drive-end bearing', authLevel: 2,
  });
  assert(ctx.incidents.length === 3, 'expected top-3 incidents from the big corpus');
  assert(ctx.incidents.every((i) => i.payload.equipment_type === 'centrifugal_pump'), 'equipment_type filter must hold at scale');
  ok(`retrieval over ${incidents.length} incidents returns 3 filtered neighbours (backend clean)`);

  console.log(`\n━━━ HISTORY CHECK PASSED — ${passed} assertions green (${incidents.length} incidents, OEM ${OEM_MANUALS.length}, runbooks ${RUNBOOK_LIBRARY.length}) ━━━\n`);
}
main().catch((e) => { console.error('\n✗ HISTORY CHECK FAILED:', e.message ?? e); process.exit(1); });
