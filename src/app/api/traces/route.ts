// GET /api/traces — live observability feed (NFR-01): trace events + GenAI
// usage summary from the in-process TraceStore.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, rateLimit } from '@/lib/auth';
import { readEvents, usageSummary } from '@/lib/telemetry';

export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  const correlationId = req.nextUrl.searchParams.get('correlationId') ?? undefined;
  return NextResponse.json({
    summary: usageSummary(),
    events: readEvents({ correlationId, limit: 150 }),
  });
}
