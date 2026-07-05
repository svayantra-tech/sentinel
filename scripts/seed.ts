// Seed Qdrant (or the in-memory fallback) with the Sentinel corpus.
// Usage: npm run seed            (idempotent — deterministic IDs, safe to re-run)
//        npm run seed -- --reset (delete + recreate collections first)
// Requires QDRANT_URL for cloud persistence; see .env.example.
import { seedAll, resetVectorStore } from '../src/lib/memory';
import { buildIncidentCorpus, OEM_MANUALS, RUNBOOK_LIBRARY } from '../src/data/seed-corpus';

async function main() {
  const reset = process.argv.includes('--reset');
  if (reset) {
    console.log('--reset: deleting and recreating collections…');
    await resetVectorStore();
  }
  const result = await seedAll({
    incidents: buildIncidentCorpus(),
    manuals: OEM_MANUALS,
    runbooks: RUNBOOK_LIBRARY,
  });
  console.log(`Seeded backend=${result.backend} — 15-year deployment corpus`);
  for (const [c, n] of Object.entries(result.counts)) console.log(`  ${c}: ${n} points`);
  console.log('\nIDs are deterministic — re-running this does NOT double the point count.');
  if (result.backend === 'memory') {
    console.log('Note: memory backend is per-process. Set QDRANT_URL (free cluster at cloud.qdrant.io) to persist.');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
