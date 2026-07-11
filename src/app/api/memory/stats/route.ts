// GET /api/memory/stats — live vector-store inspection: backend, per-collection
// point counts, vector dim, and (when on Qdrant) the cluster host — computed
// straight from the store. Powers the Knowledge connection banner and the
// Observability backend chip.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, rateLimit } from '@/lib/auth';
import { storeStats } from '@/lib/memory';

export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  try {
    return NextResponse.json(await storeStats());
  } catch (err) {
    // The vector store (cloud Qdrant) is unreachable. This endpoint is a
    // connection/health indicator, so returning zeroed counts would falsely read
    // as an empty store — report unhealthy honestly. Log the real cause.
    console.error('[GET /api/memory/stats] vector store unavailable:', err);
    return NextResponse.json({ error: 'Vector store unavailable' }, { status: 503 });
  }
}
