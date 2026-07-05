// GET /api/assets — the whole fleet with history-derived health, MTBF, trend,
// open-WO count, and last-incident summary (PART B). Replaces the hardcoded
// FLEET grid; the one-click demo presets live in /api/fleet.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, rateLimit } from '@/lib/auth';
import { assetSummaries } from '@/lib/analytics';

export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  return NextResponse.json({ assets: assetSummaries() });
}
