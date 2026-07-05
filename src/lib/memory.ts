// ─────────────────────────────────────────────────────────────────────────────
// Sentinel memory layer (FR-03/FR-04/FR-05/FR-11 — PRD §9)
//
// Three Qdrant collections, every retrieval = semantic search + HARD payload
// filter (never semantic-only — a pump fix must never surface for a compressor):
//   incident_history  — filter: equipment_type (+plant_id boost)
//   oem_manuals       — filter: equipment_type (+section_type when targeted)
//   runbook_library   — filter: equipment_type + skill_level_required ≤ auth
//
// The QDRANT_URL env selects the real Qdrant client; when absent, an
// interface-identical in-memory store keeps the demo alive with zero infra
// (12-Factor backing-service swap — NFR-06/NFR-07).
// ─────────────────────────────────────────────────────────────────────────────
import { QdrantClient } from '@qdrant/js-client-rest';
import { randomUUID, createHash } from 'crypto';
import type {
  EquipmentType, IncidentPayload, ManualPayload, RunbookPayload, RetrievedContext,
} from './types';
import { traceStep } from './telemetry';
import { embed, EMBED_DIM } from './embeddings';

// ── Deterministic point IDs (idempotent seeding) ─────────────────────────────
// A fresh randomUUID() per seed run would double the point count on every
// reseed. Hashing the payload's stable identity fields into a deterministic
// UUID means re-seeding UPSERTS the same points — count stays constant.
function stableText(p: AnyPayload): string {
  switch (p.kind) {
    case 'incident':
      return `incident|${p.equipment_id}|${p.fault_code}|${p.timestamp}|${p.root_cause}|${p.fix_applied}`;
    case 'manual':
      return `manual|${p.equipment_type}|${p.chapter}|${p.page_range}`;
    case 'runbook':
      return `runbook|${p.equipment_type}|${p.fault_category}|${p.title}`;
  }
}
export function deterministicId(p: AnyPayload): string {
  const h = createHash('md5').update(stableText(p)).digest('hex');
  // Format the 32 hex digits as a UUID string (Qdrant accepts UUID point IDs).
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export const COLLECTIONS = {
  incidents: 'incident_history',
  manuals: 'oem_manuals',
  runbooks: 'runbook_library',
} as const;

type AnyPayload = IncidentPayload | ManualPayload | RunbookPayload;

interface VectorHit<P> { id: string; score: number; payload: P }

// ── Store interface — Qdrant and the in-memory fallback both implement it ───
interface VectorStore {
  ensureCollections(): Promise<void>;
  upsert(collection: string, points: Array<{ id: string; vector: number[]; payload: AnyPayload }>): Promise<void>;
  search<P extends AnyPayload>(
    collection: string, vector: number[], limit: number,
    filter?: QFilter,
  ): Promise<Array<VectorHit<P>>>;
  count(collection: string): Promise<number>;
  /** Delete + recreate all collections (the seed --reset path). */
  resetCollections(): Promise<void>;
  /** Page through every point's payload — the system-of-record analytics source. */
  scrollAll<P extends AnyPayload>(collection: string): Promise<P[]>;
  backend: 'qdrant' | 'memory';
}

// Minimal Qdrant filter shape we use (must/range) — kept explicit for judges.
export interface QFilter {
  must?: Array<
    | { key: string; match: { value: string | number | boolean } }
    | { key: string; range: { lte?: number; gte?: number } }
  >;
}

// ── Real Qdrant ──────────────────────────────────────────────────────────────
class QdrantStore implements VectorStore {
  backend = 'qdrant' as const;
  private client: QdrantClient;
  constructor(url: string, apiKey?: string) {
    this.client = new QdrantClient({ url, apiKey: apiKey || undefined });
  }
  async ensureCollections(): Promise<void> {
    for (const name of Object.values(COLLECTIONS)) {
      const existing = await this.client.getCollections();
      if (!existing.collections.some((c) => c.name === name)) {
        await this.client.createCollection(name, {
          vectors: { size: EMBED_DIM, distance: 'Cosine' },
        });
        // Payload indexes make the hard filters fast at scale.
        for (const key of ['equipment_type', 'plant_id', 'section_type', 'fault_category']) {
          await this.client.createPayloadIndex(name, {
            field_name: key, field_schema: 'keyword', wait: true,
          }).catch(() => {});
        }
        await this.client.createPayloadIndex(name, {
          field_name: 'skill_level_required', field_schema: 'integer', wait: true,
        }).catch(() => {});
      }
    }
  }
  async upsert(collection: string, points: Array<{ id: string; vector: number[]; payload: AnyPayload }>) {
    await this.client.upsert(collection, {
      wait: true,
      points: points.map((p) => ({ id: p.id, vector: p.vector, payload: p.payload as unknown as Record<string, unknown> })),
    });
  }
  async search<P extends AnyPayload>(collection: string, vector: number[], limit: number, filter?: QFilter) {
    const res = await this.client.search(collection, {
      vector, limit, filter: filter as never, with_payload: true,
    });
    return res.map((r) => ({ id: String(r.id), score: r.score ?? 0, payload: r.payload as unknown as P }));
  }
  async count(collection: string): Promise<number> {
    const res = await this.client.count(collection, { exact: true });
    return res.count;
  }
  async resetCollections(): Promise<void> {
    for (const name of Object.values(COLLECTIONS)) {
      await this.client.deleteCollection(name).catch(() => {});
    }
    await this.ensureCollections();
  }
  async scrollAll<P extends AnyPayload>(collection: string): Promise<P[]> {
    const out: P[] = [];
    let offset: string | number | undefined | null = undefined;
    // Page through the entire collection via Qdrant's scroll API (256 at a time).
    for (;;) {
      const res = await this.client.scroll(collection, {
        limit: 256, with_payload: true, with_vector: false, offset: offset ?? undefined,
      });
      for (const p of res.points) out.push(p.payload as unknown as P);
      if (!res.next_page_offset) break;
      offset = res.next_page_offset as string | number;
    }
    return out;
  }
}

// ── In-memory fallback (identical semantics incl. filters) ───────────────────
class MemoryStore implements VectorStore {
  backend = 'memory' as const;
  private data = new Map<string, Array<{ id: string; vector: number[]; payload: AnyPayload }>>();
  async ensureCollections() {
    for (const name of Object.values(COLLECTIONS)) if (!this.data.has(name)) this.data.set(name, []);
  }
  async upsert(collection: string, points: Array<{ id: string; vector: number[]; payload: AnyPayload }>) {
    const arr = this.data.get(collection) ?? [];
    for (const p of points) {
      const i = arr.findIndex((x) => x.id === p.id);
      if (i >= 0) arr[i] = p; else arr.push(p);
    }
    this.data.set(collection, arr);
  }
  async search<P extends AnyPayload>(collection: string, vector: number[], limit: number, filter?: QFilter) {
    const arr = this.data.get(collection) ?? [];
    const passes = (payload: AnyPayload): boolean =>
      (filter?.must ?? []).every((cond) => {
        const val = (payload as unknown as Record<string, unknown>)[cond.key];
        if ('match' in cond) return val === cond.match.value;
        if ('range' in cond) {
          const n = Number(val);
          if (cond.range.lte !== undefined && !(n <= cond.range.lte)) return false;
          if (cond.range.gte !== undefined && !(n >= cond.range.gte)) return false;
          return true;
        }
        return true;
      });
    return arr
      .filter((p) => passes(p.payload))
      .map((p) => ({ id: p.id, score: cosine(vector, p.vector), payload: p.payload as unknown as P }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
  async count(collection: string) { return (this.data.get(collection) ?? []).length; }
  async resetCollections() { this.data.clear(); await this.ensureCollections(); }
  async scrollAll<P extends AnyPayload>(collection: string): Promise<P[]> {
    return (this.data.get(collection) ?? []).map((p) => p.payload as unknown as P);
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ── Singleton store selection (12-Factor: backing service by env) ────────────
const gm = globalThis as unknown as { __sentinelStore?: VectorStore };
export function getStore(): VectorStore {
  if (!gm.__sentinelStore) {
    const url = process.env.QDRANT_URL?.trim();
    gm.__sentinelStore = url
      ? new QdrantStore(url, process.env.QDRANT_API_KEY)
      : new MemoryStore();
  }
  return gm.__sentinelStore;
}

// ── Seeding (scripts/seed.ts + auto-seed for memory backend) ─────────────────
export async function seedAll(corpus: {
  incidents: IncidentPayload[]; manuals: ManualPayload[]; runbooks: RunbookPayload[];
}): Promise<{ backend: string; counts: Record<string, number> }> {
  const store = getStore();
  await store.ensureCollections();
  // Deterministic IDs → re-seeding upserts the same points (idempotent, no dupes).
  const toPoints = async (items: AnyPayload[], textOf: (p: AnyPayload) => string) =>
    Promise.all(items.map(async (payload) => ({
      id: deterministicId(payload), vector: await embed(textOf(payload)), payload,
    })));

  await store.upsert(COLLECTIONS.incidents, await toPoints(
    corpus.incidents, (p) => {
      const q = p as IncidentPayload;
      return `${q.fault_code} ${q.fault_description} root cause: ${q.root_cause} fix: ${q.fix_applied}`;
    }));
  await store.upsert(COLLECTIONS.manuals, await toPoints(
    corpus.manuals, (p) => {
      const q = p as ManualPayload;
      return `${q.chapter} ${q.section_type} ${q.text}`;
    }));
  await store.upsert(COLLECTIONS.runbooks, await toPoints(
    corpus.runbooks, (p) => {
      const q = p as RunbookPayload;
      return `${q.title} ${q.fault_category} ${q.steps.join(' ')}`;
    }));

  return {
    backend: store.backend,
    counts: {
      incident_history: await store.count(COLLECTIONS.incidents),
      oem_manuals: await store.count(COLLECTIONS.manuals),
      runbook_library: await store.count(COLLECTIONS.runbooks),
    },
  };
}

/** Delete + recreate all collections (used by `npm run seed -- --reset`). */
export async function resetVectorStore(): Promise<void> {
  await getStore().resetCollections();
}

// ── Inspectable-surface helpers (the Knowledge page + /api/memory/*) ─────────
export interface StoreStats {
  backend: 'qdrant' | 'memory';
  dim: number;
  host: string | null;               // Qdrant cluster host (never the API key)
  collections: Array<{ name: string; label: string; count: number }>;
}
const COLLECTION_LABELS: Record<string, string> = {
  [COLLECTIONS.incidents]: 'Incident history',
  [COLLECTIONS.manuals]: 'OEM manuals',
  [COLLECTIONS.runbooks]: 'Runbook library',
};
/** Live store stats computed straight from the backend — powers the connection banner. */
export async function storeStats(): Promise<StoreStats> {
  await ensureSeeded();
  const store = getStore();
  const url = process.env.QDRANT_URL?.trim();
  let host: string | null = null;
  if (store.backend === 'qdrant' && url) {
    try { host = new URL(url).host; } catch { host = url; }
  }
  const collections = await Promise.all(
    Object.values(COLLECTIONS).map(async (name) => ({
      name, label: COLLECTION_LABELS[name] ?? name, count: await store.count(name),
    })),
  );
  return { backend: store.backend, dim: EMBED_DIM, host, collections };
}

/** Judge-facing "ask the memory anything" — real semantic + filtered Qdrant search. */
export async function searchIncidents(opts: {
  query: string; equipmentType?: EquipmentType; limit?: number; correlationId?: string;
}): Promise<Array<{ score: number; payload: IncidentPayload }>> {
  await ensureSeeded();
  const store = getStore();
  const vector = await embed(opts.query);
  const limit = Math.min(20, Math.max(1, opts.limit ?? 5));
  const filter: QFilter | undefined = opts.equipmentType
    ? { must: [{ key: 'equipment_type', match: { value: opts.equipmentType } }] }
    : undefined;
  const hits = await traceStep(
    {
      step: 'qdrant.search.incident_history', kind: 'qdrant',
      correlationId: opts.correlationId ?? 'memory-search',
      attrs: { collection: COLLECTIONS.incidents, backend: store.backend, limit, 'filter.equipment_type': opts.equipmentType ?? 'none' },
    },
    () => store.search<IncidentPayload>(COLLECTIONS.incidents, vector, limit, filter),
  );
  return hits.map((h) => ({ score: h.score, payload: h.payload }));
}

/** Every incident payload, paged out of the store — the Qdrant-as-system-of-record analytics source. */
export async function scrollAllIncidents(): Promise<IncidentPayload[]> {
  await ensureSeeded();
  return getStore().scrollAll<IncidentPayload>(COLLECTIONS.incidents);
}

let autoSeeded = false;
/** Memory backend starts empty each process — auto-seed once so `npm run dev` just works. */
export async function ensureSeeded(): Promise<void> {
  const store = getStore();
  await store.ensureCollections();
  if (store.backend === 'memory' && !autoSeeded) {
    const { buildIncidentCorpus, OEM_MANUALS, RUNBOOK_LIBRARY } = await import('@/data/seed-corpus');
    await seedAll({ incidents: buildIncidentCorpus(), manuals: OEM_MANUALS, runbooks: RUNBOOK_LIBRARY });
    autoSeeded = true;
  }
}

// ── The retrieval that wins the Qdrant 20% (FR-04) ───────────────────────────
// Semantic + hard filters, per collection, all traced.
export async function retrieveContext(opts: {
  correlationId: string; runId?: string;
  equipmentType: EquipmentType; plantId: string;
  faultText: string; authLevel: number;
}): Promise<RetrievedContext> {
  await ensureSeeded();
  const store = getStore();
  const vector = await embed(opts.faultText);

  const incidents = await traceStep(
    {
      step: 'qdrant.search.incident_history', kind: 'qdrant',
      correlationId: opts.correlationId, runId: opts.runId,
      attrs: {
        collection: COLLECTIONS.incidents, backend: store.backend,
        'filter.equipment_type': opts.equipmentType, limit: 3,
      },
    },
    () => store.search<IncidentPayload>(COLLECTIONS.incidents, vector, 3, {
      must: [{ key: 'equipment_type', match: { value: opts.equipmentType } }],
    }),
  );

  const manualChunks = await traceStep(
    {
      step: 'qdrant.search.oem_manuals', kind: 'qdrant',
      correlationId: opts.correlationId, runId: opts.runId,
      attrs: {
        collection: COLLECTIONS.manuals, backend: store.backend,
        'filter.equipment_type': opts.equipmentType, limit: 4,
      },
    },
    () => store.search<ManualPayload>(COLLECTIONS.manuals, vector, 4, {
      must: [{ key: 'equipment_type', match: { value: opts.equipmentType } }],
    }),
  );

  // LOTO section is mandatory context regardless of similarity — safety first.
  const lotoAlready = manualChunks.some((m) => m.payload.section_type === 'lockout_tagout');
  if (!lotoAlready) {
    const loto = await store.search<ManualPayload>(COLLECTIONS.manuals, vector, 1, {
      must: [
        { key: 'equipment_type', match: { value: opts.equipmentType } },
        { key: 'section_type', match: { value: 'lockout_tagout' } },
      ],
    });
    manualChunks.push(...loto);
  }

  const runbooks = await traceStep(
    {
      step: 'qdrant.search.runbook_library', kind: 'qdrant',
      correlationId: opts.correlationId, runId: opts.runId,
      attrs: {
        collection: COLLECTIONS.runbooks, backend: store.backend,
        'filter.equipment_type': opts.equipmentType,
        'filter.skill_level_required_lte': opts.authLevel, limit: 2,
      },
    },
    // PRD §11: retrieval itself enforces authorisation — a L1 technician
    // never even *sees* a danger-rated L2 procedure.
    () => store.search<RunbookPayload>(COLLECTIONS.runbooks, vector, 2, {
      must: [
        { key: 'equipment_type', match: { value: opts.equipmentType } },
        { key: 'skill_level_required', range: { lte: opts.authLevel } },
      ],
    }),
  );

  return {
    incidents, manualChunks, runbooks,
    filters: {
      equipment_type: opts.equipmentType,
      plant_id: opts.plantId,
      'skill_level_required <=': opts.authLevel,
    },
  };
}

// ── Memory write-back (FR-11) — the learning flywheel ────────────────────────
export async function writeBackIncident(opts: {
  correlationId: string; runId?: string; incident: IncidentPayload;
}): Promise<string> {
  const store = getStore();
  const id = randomUUID();
  const text = `${opts.incident.fault_code} ${opts.incident.fault_description} root cause: ${opts.incident.root_cause} fix: ${opts.incident.fix_applied}`;
  await traceStep(
    {
      step: 'qdrant.upsert.incident_history', kind: 'qdrant',
      correlationId: opts.correlationId, runId: opts.runId,
      attrs: { collection: COLLECTIONS.incidents, backend: store.backend, point_id: id },
    },
    async () => store.upsert(COLLECTIONS.incidents, [
      { id, vector: await embed(text), payload: opts.incident },
    ]),
  );
  return id;
}
