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

  const { runId, correlationId } = await startSentinelRun(body.data, auth.user);
  return NextResponse.json({ runId, correlationId }, { status: 202 });
}
