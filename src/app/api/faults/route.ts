// POST /api/faults — ingest a fault and start the Sentinel workflow (FR-01).
// JWT-protected, rate-limited, Zod-validated (FR-13/NFR-03).
import { NextRequest, NextResponse } from 'next/server';
import { FaultInput } from '@/lib/types';
import { requireAuth, rateLimit, parseBody } from '@/lib/auth';
import { startSentinelRun } from '@/mastra';

export async function POST(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;

  const body = await parseBody(req, FaultInput);
  if ('error' in body) return body.error;

  try {
    const { runId, correlationId } = await startSentinelRun(body.data, auth.user);
    return NextResponse.json({ runId, correlationId }, { status: 202 });
  } catch (err) {
    // A store/init failure (e.g. an unreachable or mis-credentialed Mastra state
    // store — the serverless failure mode) would otherwise surface as an opaque
    // 500. Log the real cause server-side (visible in runtime logs) and return a
    // clean 503 so the client can distinguish "try again" from a request bug.
    console.error('[POST /api/faults] startSentinelRun failed:', err);
    return NextResponse.json(
      { error: 'Workflow state store unavailable' },
      { status: 503 },
    );
  }
}
