// ─────────────────────────────────────────────────────────────────────────────
// Qdrant live-connection verifier — proves in 5 seconds that the data is in the
// cloud, not memory. Connects with the env creds, lists the three collections
// with exact point counts + vector dims, and runs one filtered sample search.
// Run: npm run qdrant:verify   (set QDRANT_URL / QDRANT_API_KEY first)
// ─────────────────────────────────────────────────────────────────────────────
import { storeStats, searchIncidents, getStore } from '../src/lib/memory';

async function main() {
  const url = process.env.QDRANT_URL?.trim();
  console.log('\n── Sentinel · Qdrant verify ──────────────────────────────────');
  if (!url) {
    console.log('QDRANT_URL is not set — running against the in-memory fallback.');
    console.log('Set QDRANT_URL (free cluster at https://cloud.qdrant.io) + QDRANT_API_KEY');
    console.log('and run `npm run seed` to push the corpus to the cloud first.\n');
  } else {
    console.log(`QDRANT_URL = ${url}`);
  }

  const store = getStore();
  const stats = await storeStats();
  console.log(`\nbackend        : ${stats.backend}${stats.host ? ` (${stats.host})` : ''}`);
  console.log(`vector dim     : ${stats.dim}`);
  console.log('collections    :');
  let total = 0;
  for (const c of stats.collections) {
    total += c.count;
    console.log(`  · ${c.name.padEnd(16)} ${String(c.count).padStart(6)} points`);
  }
  console.log(`total points   : ${total}`);

  if (store.backend === 'qdrant' && total === 0) {
    console.error('\n✗ Connected to Qdrant but collections are EMPTY. Run `npm run seed` first.');
    process.exit(1);
  }

  console.log('\nsample search  : "bearing vibration growl on a pump" (filter equipment_type=centrifugal_pump)');
  const hits = await searchIncidents({ query: 'bearing vibration growl on a pump', equipmentType: 'centrifugal_pump', limit: 3 });
  for (const h of hits) {
    console.log(`  ${(h.score * 100).toFixed(0)}%  ${h.payload.equipment_id} @ ${h.payload.plant_id} · ${h.payload.fault_code} — ${h.payload.root_cause.slice(0, 70)}…`);
  }
  if (hits.length === 0) { console.error('\n✗ sample search returned no hits'); process.exit(1); }
  if (!hits.every((h) => h.payload.equipment_type === 'centrifugal_pump')) {
    console.error('\n✗ equipment_type hard filter leaked'); process.exit(1);
  }

  console.log(`\n✓ ${store.backend === 'qdrant' ? 'Qdrant Cloud is live' : 'In-memory fallback is live'} — ${total} vectors indexed, filtered search working.\n`);
}
main().catch((e) => { console.error('\n✗ QDRANT VERIFY FAILED:', e?.message ?? e); process.exit(1); });
