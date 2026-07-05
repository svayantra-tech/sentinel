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
  return NextResponse.json(await storeStats());
}
