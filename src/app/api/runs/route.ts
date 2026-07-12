// GET /api/runs — list all runs (ops dashboard + technician inbox).
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, rateLimit } from '@/lib/auth';
import { listRunViews } from '@/mastra';

// Cold-instance rehydration does real (parallel, capped) Turso reads — give it
// headroom beyond the serverless default so the run list never 504s to empty.
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  // In-memory ∪ durable Mastra storage, so runs survive cold serverless processes.
  return NextResponse.json({ runs: await listRunViews() });
}
