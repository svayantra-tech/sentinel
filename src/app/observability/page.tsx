'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Observability panel (NFR-01) — the Round-1 feedback fix, made VISIBLE.
// Live GenAI usage (tokens, latency, prompt hashes), per-step spans across
// workflow/qdrant/enkrypt/mcp/scorer, correlation-ID filtering, and blocked
// events in red. Backed by the in-process TraceStore; the same spans export
// to Jaeger via OTLP when OTEL_EXPORTER_OTLP_ENDPOINT is set.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { usePoll, useSession } from '@/lib/client';
import type { OrgAnalytics } from '@/lib/analytics';
import { compactINR, num } from '@/lib/format';

interface TraceEvent {
  id: string; correlationId: string; runId?: string; step: string;
  kind: string; status: string; startedAt: string; latencyMs: number;
  attrs: Record<string, string | number | boolean>;
}
interface Payload {
  summary: { totalRuns: number; llmCalls: number; tokensIn: number; tokensOut: number; avgLlmLatencyMs: number; blockedCount: number };
  events: TraceEvent[];
}

const KIND_COLOR: Record<string, string> = {
  workflow: 'text-offwhite border-dim',
  llm: 'text-teal border-teal/50',
  qdrant: 'text-[#7aa2ff] border-[#7aa2ff]/50',
  enkrypt: 'text-amber border-amber/50',
  mcp: 'text-[#c084fc] border-[#c084fc]/50',
  scorer: 'text-[#f472b6] border-[#f472b6]/50',
};

export default function ObservabilityPage() {
  const { user, ready } = useSession();
  const [filter, setFilter] = useState<string>('');
  const { data } = usePoll<Payload>(user ? `/api/traces${filter ? `?correlationId=${filter}` : ''}` : null, 2000);
  const { data: org } = usePoll<OrgAnalytics>(user ? '/api/analytics' : null, 60_000);
  const { data: mem } = usePoll<{ backend: string; host: string | null }>(user ? '/api/memory/stats' : null, 30_000);

  if (!ready) return null;
  if (!user) return (
    <main className="mx-auto max-w-md px-4 pt-20 text-center text-muted">
      <p>Sign in on the <a href="/" className="text-teal underline">Operations</a> page first.</p>
    </main>
  );

  const s = data?.summary;
  const correlations = [...new Set((data?.events ?? []).map((e) => e.correlationId))];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <h1 className="text-2xl font-bold">LLM Observability</h1>
        {mem && (
          <span className={`chip ${mem.backend === 'qdrant' ? 'border-[#7aa2ff]/60 text-[#7aa2ff]' : 'border-amber/60 text-amber'}`}>
            Vector store: {mem.backend === 'qdrant' ? `Qdrant Cloud${mem.host ? ` · ${mem.host}` : ''}` : 'in-memory (set QDRANT_URL)'}
          </span>
        )}
      </div>
      <p className="text-muted text-sm mb-5">
        OpenTelemetry spans with GenAI semantic attributes · prompt-hash drift tracking · correlation IDs across every service.
        Export to Jaeger: <span className="font-mono text-teal">docker compose up -d</span> → localhost:16686
      </p>

      {/* All-time deployment strip — corpus-derived so the panel is never empty */}
      {org && (
        <div className="panel p-3 mb-4">
          <p className="text-[10px] font-mono text-muted uppercase mb-2">15-year deployment · institutional record</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              ['incidents resolved', num(org.kpis.incidentsResolved)],
              ['downtime hrs prevented', num(org.kpis.downtimeHoursPrevented)],
              ['₹ saved', compactINR(org.kpis.rupeesSaved)],
              ['avg MTTR now', `${org.kpis.avgMttrNow}m`],
              ['MTTR improvement', `${org.kpis.mttrImprovementPct}%`],
            ].map(([label, val], i) => (
              <div key={i} className="text-center">
                <p className="text-lg font-bold text-teal">{val}</p>
                <p className="text-[10px] font-mono text-muted uppercase mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[10px] font-mono text-muted uppercase mb-2">this session · live trace telemetry</p>
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mb-5">
        {[
          ['runs', s?.totalRuns], ['llm calls', s?.llmCalls],
          ['tokens in', s?.tokensIn], ['tokens out', s?.tokensOut],
          ['avg llm latency', s ? `${s.avgLlmLatencyMs}ms` : '—'],
          ['⛔ blocked', s?.blockedCount],
        ].map(([label, val], i) => (
          <div key={i} className={`panel p-3 text-center ${label === '⛔ blocked' && Number(val) > 0 ? '!border-danger/60' : ''}`}>
            <p className={`text-xl font-bold ${label === '⛔ blocked' && Number(val) > 0 ? 'text-danger' : 'text-teal'}`}>{val ?? '—'}</p>
            <p className="text-[10px] font-mono text-muted uppercase mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-mono text-muted">correlation:</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          className="bg-ink border border-dim rounded-lg px-2 py-1 text-xs font-mono">
          <option value="">all runs</option>
          {correlations.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="panel overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted font-mono border-b border-dim/60">
              <th className="px-3 py-2">time</th>
              <th className="px-3 py-2">correlation</th>
              <th className="px-3 py-2">span</th>
              <th className="px-3 py-2">kind</th>
              <th className="px-3 py-2 text-right">latency</th>
              <th className="px-3 py-2">attributes</th>
            </tr>
          </thead>
          <tbody>
            {(data?.events ?? []).map((e) => (
              <tr key={e.id} className={`border-b border-dim/30 ${e.status === 'blocked' ? 'bg-danger/10' : e.status === 'error' ? 'bg-amber/5' : ''}`}>
                <td className="px-3 py-1.5 font-mono text-muted/70 whitespace-nowrap">{new Date(e.startedAt).toLocaleTimeString()}</td>
                <td className="px-3 py-1.5 font-mono text-muted">{e.correlationId}</td>
                <td className={`px-3 py-1.5 font-mono ${e.status === 'blocked' ? 'text-danger font-bold' : 'text-offwhite'}`}>{e.step}</td>
                <td className="px-3 py-1.5"><span className={`chip ${KIND_COLOR[e.kind] ?? 'text-muted border-dim'}`}>{e.kind}</span></td>
                <td className="px-3 py-1.5 font-mono text-right text-muted">{e.latencyMs}ms</td>
                <td className="px-3 py-1.5 font-mono text-muted/80 max-w-[380px] truncate">
                  {Object.entries(e.attrs).map(([k, v]) => `${k}=${v}`).join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(data?.events ?? []).length === 0 && (
          <p className="text-center text-muted text-sm py-8">No traces yet — inject a fault from Operations.</p>
        )}
      </div>
    </main>
  );
}
