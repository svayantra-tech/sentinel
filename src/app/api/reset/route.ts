// POST /api/reset — corpus-safe demo reset. Clears RUN STATE (in-memory run
// registry + persisted Mastra workflow snapshots) and deletes ONLY the
// run-generated write-back incidents marked demo_generated=true.
// The seeded corpus is never touched: the Qdrant deletion goes through
// clearDemoWriteBacks(), which (a) filters exclusively on the demo_generated
// marker, (b) aborts untouched if the filter matches > 100 points, and
// (c) sits on deleteWhere, which structurally refuses an empty filter —
// a "clear collection / delete all" cannot be expressed on this path.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@libsql/client';
import { requireAuth, rateLimit } from '@/lib/auth';
import { clearRuns } from '@/lib/run-registry';
import { clearDemoWriteBacks } from '@/lib/memory';
import { setResetWatermark } from '@/lib/reset-watermark';

export async function POST(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;

  // 1 · Run state: in-memory projections + persisted workflow snapshots.
  const runsCleared = clearRuns();
  let snapshotsCleared = 0;
  try {
    const db = createClient({
      url: process.env.MASTRA_DB_URL || 'file:./sentinel.db',
      authToken: process.env.MASTRA_DB_AUTH_TOKEN || undefined,
    });
    const c = await db.execute('SELECT COUNT(*) AS n FROM mastra_workflow_snapshot');
    snapshotsCleared = Number(c.rows[0]?.n ?? 0);
    // Run snapshots only — this table holds disposable workflow state, not corpus.
    await db.execute('DELETE FROM mastra_workflow_snapshot');
    db.close();
    // Watermark: other serverless instances drop their stale in-memory views,
    // so a reload after reset stays clean on every instance.
    await setResetWatermark();
  } catch (err) {
    console.error('[POST /api/reset] snapshot clear failed:', err);
    return NextResponse.json({ error: 'Workflow state store unavailable — nothing deleted from memory' }, { status: 503 });
  }

  // 2 · Vector memory: run-generated write-backs ONLY (guarded, see header).
  try {
    const { removed, before, after } = await clearDemoWriteBacks();
    return NextResponse.json({
      runsCleared, snapshotsCleared,
      writeBacksRemoved: removed,
      incidentsBefore: before, incidentsAfter: after,
    });
  } catch (err) {
    console.error('[POST /api/reset] write-back clear failed:', err);
    const msg = String((err as Error).message ?? err);
    // The >cap abort and the empty-filter refusal both land here — deletion did not happen.
    return NextResponse.json({ error: msg, runsCleared, snapshotsCleared, writeBacksRemoved: 0 }, { status: msg.includes('aborted') ? 409 : 503 });
  }
}
