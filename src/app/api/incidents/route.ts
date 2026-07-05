// GET /api/incidents — the historical incident browser over all ~3,000 records:
// filter by plant/equipmentId/equipmentType/faultCode/severity/outcome/date
// range; sortable by timestamp/mttr/cost; paginated (PART B).
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, rateLimit } from '@/lib/auth';
import { queryIncidents, type IncidentQuery } from '@/lib/analytics';

export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;

  const q = new URL(req.url).searchParams;
  const str = (k: string) => q.get(k) || undefined;
  const query: IncidentQuery = {
    plant: str('plant'), equipmentId: str('equipmentId'), equipmentType: str('equipmentType'),
    faultCode: str('faultCode'), severity: str('severity'), outcome: str('outcome'),
    from: str('from'), to: str('to'),
    sort: (str('sort') as IncidentQuery['sort']) ?? 'timestamp',
    dir: (str('dir') as IncidentQuery['dir']) ?? 'desc',
    page: q.get('page') ? Number(q.get('page')) : 1,
    pageSize: q.get('pageSize') ? Number(q.get('pageSize')) : 25,
  };
  return NextResponse.json(queryIncidents(query));
}
