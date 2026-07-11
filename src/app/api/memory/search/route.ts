// POST /api/memory/search — "ask the memory anything": a real semantic +
// payload-filtered search against the incident_history collection. Exercises
// Qdrant directly and returns scored hits. JWT-protected, Zod-validated.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, rateLimit, parseBody } from '@/lib/auth';
import { EquipmentType } from '@/lib/types';
import { searchIncidents, getStore } from '@/lib/memory';

const SearchBody = z.object({
  query: z.string().min(2).max(400),
  equipmentType: EquipmentType.optional(),
  limit: z.number().int().min(1).max(20).optional(),
});

export async function POST(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;

  const body = await parseBody(req, SearchBody);
  if ('error' in body) return body.error;

  try {
    const hits = await searchIncidents({
      query: body.data.query,
      equipmentType: body.data.equipmentType,
      limit: body.data.limit ?? 5,
      correlationId: `knowledge-${auth.user.sub}`,
    });
    return NextResponse.json({ backend: getStore().backend, query: body.data.query, hits });
  } catch (err) {
    // Qdrant/embeddings unreachable — degrade to an empty result set (a valid,
    // non-misleading answer for a search) rather than a 500. Log the real cause.
    console.error('[POST /api/memory/search] search unavailable:', err);
    return NextResponse.json({ backend: getStore().backend, query: body.data.query, hits: [] });
  }
}
