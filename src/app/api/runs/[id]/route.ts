// GET /api/runs/:id — live run view (polled by the dashboards).
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, rateLimit } from '@/lib/auth';
import { getRun } from '@/lib/run-registry';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  const run = getRun(params.id);
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ run: run.view });
}
