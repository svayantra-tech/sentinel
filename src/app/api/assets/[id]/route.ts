// GET /api/assets/[id] — full asset dossier: failure-mode breakdown, MTBF/MTTR
// time series, total downtime + cost, and the paginated incident history (PART B).
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, rateLimit } from '@/lib/auth';
import { assetDossier } from '@/lib/analytics';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;

  const dossier = assetDossier(params.id);
  if (!dossier) return NextResponse.json({ error: `Unknown asset ${params.id}` }, { status: 404 });

  // Paginate the incident history so the dossier stays light.
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
  const pageSize = Math.min(100, Math.max(5, Number(url.searchParams.get('pageSize') ?? 20)));
  const total = dossier.incidents.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(pages, page);
  const incidents = dossier.incidents.slice((p - 1) * pageSize, (p - 1) * pageSize + pageSize);

  return NextResponse.json({
    ...dossier,
    incidents,
    incidentPage: { page: p, pageSize, total, pages },
  });
}
