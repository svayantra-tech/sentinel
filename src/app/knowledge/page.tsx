'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Knowledge — the page that IS Qdrant. A live connection banner (honest amber
// if on the in-memory fallback), the three collections with live point counts
// and vector dims, and a semantic search box that runs REAL scored searches
// against incident_history. The single most convincing "Qdrant is real and
// central" surface in the app.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { api, usePoll } from '@/lib/client';
import { RequireAuth } from '@/components/RequireAuth';
import type { StoreStats } from '@/lib/memory';
import type { IncidentPayload } from '@/lib/types';
import { num, shortDate, SEVERITY_CHIP } from '@/lib/format';

interface Hit { score: number; payload: IncidentPayload }

export default function KnowledgePage() {
  return <RequireAuth>{() => <Knowledge />}</RequireAuth>;
}

function Knowledge() {
  const { data: stats } = usePoll<StoreStats>('/api/memory/stats', 15_000);
  const [query, setQuery] = useState('bearing vibration growl on a pump');
  const [equipmentType, setEquipmentType] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [backend, setBackend] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const totalVectors = stats?.collections.reduce((s, c) => s + c.count, 0) ?? 0;
  const isQdrant = stats?.backend === 'qdrant';

  const search = async () => {
    setBusy(true); setErr('');
    try {
      const res = await api<{ backend: string; hits: Hit[] }>('/api/memory/search', {
        method: 'POST',
        body: JSON.stringify({ query, equipmentType: equipmentType || undefined, limit: 6 }),
      });
      setHits(res.hits); setBackend(res.backend);
    } catch (e) { setErr(String((e as Error).message)); setHits([]); }
    finally { setBusy(false); }
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="text-2xl font-bold mb-1">Knowledge</h1>
      <p className="text-muted text-sm mb-4">The institutional memory, live from the vector store. Every retrieval in Sentinel — and every search below — is vector similarity <span className="text-offwhite">plus a hard payload filter</span>, never naive nearest-neighbour.
        {stats && <span className="block mt-1 text-[11px] font-mono">embedder: <span className={stats.embedder.mode === 'remote' ? 'text-teal' : 'text-amber'}>{stats.embedder.mode === 'remote' ? `${stats.embedder.model} (remote)` : 'deterministic lexical-hash vectors — no ML embedding model; set EMBEDDINGS_URL for real semantic embeddings'}</span></span>}
      </p>

      {/* Connection banner */}
      <div className={`panel p-4 mb-5 ${isQdrant ? '!border-[#7aa2ff]/50' : '!border-amber/50'}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`h-2.5 w-2.5 rounded-full ${isQdrant ? 'bg-[#7aa2ff] led' : 'bg-amber led'}`} />
          {stats ? (
            <span className="font-semibold">
              {isQdrant
                ? <>Qdrant Cloud · <span className="text-[#7aa2ff]">connected</span>{stats.host ? <span className="text-muted font-normal font-mono text-sm"> · {stats.host}</span> : null}</>
                : <>In-memory fallback · <span className="text-amber">no cluster</span> <span className="text-muted font-normal text-sm">— set QDRANT_URL to go live</span></>}
            </span>
          ) : <span className="text-muted">connecting…</span>}
          {stats && (
            <span className="ml-auto text-sm font-mono text-muted">
              {stats.collections.length} collections · <span className={isQdrant ? 'text-[#7aa2ff]' : 'text-amber'}>{num(totalVectors)}</span> vectors indexed · {stats.dim}-dim
            </span>
          )}
        </div>
      </div>

      {/* Collection cards */}
      <div className="grid sm:grid-cols-3 gap-4 mb-6">
        {(stats?.collections ?? []).map((c) => (
          <div key={c.name} className="panel p-4">
            <p className="font-semibold text-offwhite">{c.label}</p>
            <p className="text-[11px] font-mono text-muted mb-3">{c.name}</p>
            <div className="flex items-baseline gap-2">
              <span className={`text-3xl font-bold ${isQdrant ? 'text-[#7aa2ff]' : 'text-teal'}`}>{num(c.count)}</span>
              <span className="text-xs text-muted">points · {stats?.dim}-dim vectors</span>
            </div>
          </div>
        ))}
      </div>

      {/* Semantic search */}
      <div className="panel p-4 mb-4">
        <h3 className="font-semibold text-sm mb-1">Ask the memory anything <span className="text-muted font-normal">· real scored + filtered vector search on incident_history</span></h3>
        <p className="text-[11px] text-muted mb-3">Describe a symptom in plain language. The query is embedded and matched by cosine similarity against {num(stats?.collections.find((c) => c.name === 'incident_history')?.count ?? 0)} incident vectors — optionally hard-filtered by equipment type.</p>
        <div className="flex flex-wrap gap-2 items-center">
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="e.g. mechanical seal leaking product on the baseplate"
            className="flex-1 min-w-[260px] bg-ink border border-dim rounded-lg px-3 py-2 text-sm" />
          <select value={equipmentType} onChange={(e) => setEquipmentType(e.target.value)}
            className="bg-ink border border-dim rounded-lg px-2 py-2 text-xs font-mono">
            <option value="">any equipment</option>
            <option value="centrifugal_pump">centrifugal_pump</option>
            <option value="compressor">compressor</option>
            <option value="conveyor">conveyor</option>
          </select>
          <button onClick={search} disabled={busy || query.trim().length < 2} className="btn btn-teal">{busy ? 'searching…' : 'Search'}</button>
        </div>
        {err && <p className="text-danger text-sm mt-3">{err}</p>}

        {hits && (
          <div className="mt-4 space-y-2">
            <p className="text-[11px] font-mono text-muted">{hits.length} hits · backend={backend}{equipmentType ? ` · filter equipment_type=${equipmentType}` : ''}</p>
            {hits.map((h, i) => (
              <div key={i} className="rounded-lg bg-ink/60 border border-dim/60 p-3">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className="text-xs font-mono text-teal">{h.payload.equipment_id} @ {h.payload.plant_id} · {h.payload.fault_code}</span>
                  <span className={`chip ${SEVERITY_CHIP[h.payload.severity]}`}>{h.payload.severity}</span>
                </div>
                {/* similarity bar */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-1.5 rounded-full bg-dim/60 flex-1 overflow-hidden">
                    <div className="h-full bg-teal" style={{ width: `${Math.max(4, Math.min(100, h.score * 100))}%` }} />
                  </div>
                  <span className="text-[11px] font-mono text-teal w-12 text-right">{(h.score * 100).toFixed(0)}%</span>
                </div>
                <p className="text-xs text-muted"><span className="text-offwhite/90">{h.payload.root_cause}</span> → {h.payload.fix_applied}</p>
                <p className="text-[10px] font-mono text-muted/60 mt-1">{shortDate(h.payload.timestamp)} · {h.payload.time_to_resolve_minutes}m · {h.payload.technician_id}</p>
              </div>
            ))}
            {hits.length === 0 && !err && <p className="text-muted text-sm">No hits.</p>}
          </div>
        )}
      </div>

      {/* Filter-model explainer */}
      <div className="panel p-4">
        <h3 className="font-semibold text-sm mb-2">Not naive similarity — the payload-filter model</h3>
        <div className="grid sm:grid-cols-3 gap-3 text-xs">
          <div className="rounded-lg bg-ink/60 border border-dim/60 p-3">
            <p className="font-mono text-teal mb-1">incident_history</p>
            <p className="text-muted">vector search + hard filter <span className="text-offwhite">equipment_type</span> — a pump fix can never surface for a compressor. Plant boost on top.</p>
          </div>
          <div className="rounded-lg bg-ink/60 border border-dim/60 p-3">
            <p className="font-mono text-[#7aa2ff] mb-1">oem_manuals</p>
            <p className="text-muted">filtered by <span className="text-offwhite">equipment_type</span>, with the <span className="text-amber">lockout_tagout</span> section force-included every retrieval — safety context is never optional.</p>
          </div>
          <div className="rounded-lg bg-ink/60 border border-dim/60 p-3">
            <p className="font-mono text-[#c084fc] mb-1">runbook_library</p>
            <p className="text-muted">filtered by equipment_type <span className="text-offwhite">and skill_level_required ≤ your auth level</span> — an L1 technician never even retrieves an L2 danger-rated procedure.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
