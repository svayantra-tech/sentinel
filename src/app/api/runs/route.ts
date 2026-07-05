// GET /api/runs — list all runs (ops dashboard + technician inbox).
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, rateLimit } from '@/lib/auth';
import { listRuns } from '@/lib/run-registry';

export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  return NextResponse.json({ runs: listRuns() });
}
