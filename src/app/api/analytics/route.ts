// GET /api/analytics — org-wide executive aggregates over the 15-year corpus:
// incidents-per-month, the ⭐ MTTR-trend (the flywheel — slopes down),
// downtime-cost-per-year, cumulative savings, top failure modes, plant
// comparison, and headline KPIs (PART B).
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, rateLimit } from '@/lib/auth';
import { orgAnalytics, orgAnalyticsFromQdrant } from '@/lib/analytics';

export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;

  // ?source=qdrant → aggregate by scrolling Qdrant as the system of record
  // (falls back to the generated array when QDRANT_URL is unset).
  const source = new URL(req.url).searchParams.get('source');
  if (source === 'qdrant') {
    try {
      return NextResponse.json(await orgAnalyticsFromQdrant());
    } catch (err) {
      // Qdrant scroll failed — fall back to the equivalent aggregate over the
      // in-memory corpus (same shape, fully populated) so the dashboard still
      // renders instead of 500-ing. Log the real cause.
      console.error('[GET /api/analytics?source=qdrant] scroll failed, using array source:', err);
      return NextResponse.json(orgAnalytics());
    }
  }
  return NextResponse.json(orgAnalytics());
}
