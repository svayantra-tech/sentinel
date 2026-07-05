// GET /api/technicians — the roster with resolution counts, avg MTTR,
// specialization, and top assets, all DERIVED from the incident corpus (PART B).
// ?id=T-#### returns a single technician's derived stats.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, rateLimit } from '@/lib/auth';
import { technicianSummaries, technicianSummary } from '@/lib/analytics';

export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;

  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    const t = technicianSummary(id);
    return t ? NextResponse.json({ technician: t }) : NextResponse.json({ error: `Unknown technician ${id}` }, { status: 404 });
  }
  return NextResponse.json({ technicians: technicianSummaries() });
}
