'use client';
// ─────────────────────────────────────────────────────────────────────────────
// History — the incident browser over all ~3,000 records. Full filter bar
// (plant · type · fault · severity · outcome · date range), sortable, paginated;
// each row expands to root cause / fix / technician / cost. From /api/incidents.
// ─────────────────────────────────────────────────────────────────────────────
import { Fragment, useState } from 'react';
import { usePoll } from '@/lib/client';
import { RequireAuth } from '@/components/RequireAuth';
import type { IncidentPage } from '@/lib/analytics';
import { inr, num, shortDate, SEVERITY_CHIP } from '@/lib/format';

export default function HistoryPage() {
  return <RequireAuth>{() => <History />}</RequireAuth>;
}

interface Filters {
  plant: string; equipmentType: string; faultCode: string; severity: string; outcome: string;
  from: string; to: string; sort: string; dir: string;
}
const EMPTY: Filters = { plant: '', equipmentType: '', faultCode: '', severity: '', outcome: '', from: '', to: '', sort: 'timestamp', dir: 'desc' };

function History() {
  const [f, setF] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
  qs.set('page', String(page));
  qs.set('pageSize', '25');

  const { data } = usePoll<IncidentPage>(`/api/incidents?${qs.toString()}`, 60_000);
  const set = (patch: Partial<Filters>) => { setF({ ...f, ...patch }); setPage(1); };
  const facets = data?.facets;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex items-end justify-between flex-wrap gap-2 mb-4">
        <div>
          <h1 className="text-2xl font-bold">History</h1>
          <p className="text-muted text-sm">{data ? `${num(data.total)} incidents match` : 'Loading…'} · every record is a real institutional-memory entry retrievable by the agent</p>
        </div>
        <button onClick={() => { setF(EMPTY); setPage(1); }} className="btn btn-ghost !py-1.5">Reset filters</button>
      </div>

      {/* Filter bar */}
      <div className="panel p-3 mb-4 flex flex-wrap gap-2 items-center text-sm">
        <Sel label="plant" value={f.plant} onChange={(v) => set({ plant: v })} options={facets?.plants ?? []} />
        <Sel label="type" value={f.equipmentType} onChange={(v) => set({ equipmentType: v })} options={facets?.equipmentTypes ?? []} />
        <Sel label="fault" value={f.faultCode} onChange={(v) => set({ faultCode: v })} options={facets?.faultCodes ?? []} />
        <Sel label="severity" value={f.severity} onChange={(v) => set({ severity: v })} options={facets?.severities ?? []} />
        <Sel label="outcome" value={f.outcome} onChange={(v) => set({ outcome: v })} options={facets?.outcomes ?? []} />
        <label className="flex items-center gap-1"><span className="text-xs font-mono text-muted">from:</span>
          <input type="date" value={f.from ? f.from.slice(0, 10) : ''} onChange={(e) => set({ from: e.target.value ? `${e.target.value}T00:00:00.000Z` : '' })}
            className="bg-ink border border-dim rounded-lg px-2 py-1 text-xs font-mono" /></label>
        <label className="flex items-center gap-1"><span className="text-xs font-mono text-muted">to:</span>
          <input type="date" value={f.to ? f.to.slice(0, 10) : ''} onChange={(e) => set({ to: e.target.value ? `${e.target.value}T23:59:59.999Z` : '' })}
            className="bg-ink border border-dim rounded-lg px-2 py-1 text-xs font-mono" /></label>
        <div className="ml-auto flex items-center gap-2">
          <Sel label="sort" value={f.sort} onChange={(v) => set({ sort: v })} options={['timestamp', 'mttr', 'cost']} allowEmpty={false} />
          <Sel label="dir" value={f.dir} onChange={(v) => set({ dir: v })} options={['desc', 'asc']} allowEmpty={false} />
        </div>
      </div>

      {/* Table */}
      <div className="panel overflow-x-auto">
        <table className="w-full text-xs min-w-[820px]">
          <thead>
            <tr className="text-left text-muted font-mono border-b border-dim/60">
              <th className="px-3 py-2">date</th><th className="px-3 py-2">asset</th><th className="px-3 py-2">plant</th>
              <th className="px-3 py-2">fault</th><th className="px-3 py-2">severity</th>
              <th className="px-3 py-2 text-right">MTTR</th><th className="px-3 py-2 text-right">downtime ₹</th><th className="px-3 py-2">tech</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r) => (
              <Fragment key={r.id}>
                <tr className="border-b border-dim/30 hover:bg-dim/20 cursor-pointer" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className="px-3 py-2 font-mono text-muted/80 whitespace-nowrap">{shortDate(r.timestamp)}</td>
                  <td className="px-3 py-2"><a href={`/assets/${r.equipmentId}`} onClick={(e) => e.stopPropagation()} className="font-mono text-offwhite hover:text-teal">{r.equipmentId}</a></td>
                  <td className="px-3 py-2 font-mono text-muted">{r.plantId}</td>
                  <td className="px-3 py-2 font-mono text-teal">{r.faultCode}</td>
                  <td className="px-3 py-2"><span className={`chip ${SEVERITY_CHIP[r.severity]}`}>{r.severity}</span>{r.outcome === 'escalated' && <span className="chip border-danger/50 text-danger ml-1">esc</span>}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted">{r.mttrMinutes}m</td>
                  <td className="px-3 py-2 text-right font-mono text-muted/80">{inr(r.downtimeCostINR)}</td>
                  <td className="px-3 py-2 font-mono text-muted/80">{r.technicianId}</td>
                </tr>
                {open === r.id && (
                  <tr className="border-b border-dim/30 bg-ink/40">
                    <td colSpan={8} className="px-4 py-3">
                      <div className="grid sm:grid-cols-2 gap-3 text-[12px]">
                        <div>
                          <p className="text-muted font-mono text-[10px] uppercase mb-1">Root cause</p>
                          <p className="text-offwhite mb-2">{r.rootCause}</p>
                          <p className="text-muted font-mono text-[10px] uppercase mb-1">Fix applied</p>
                          <p className="text-offwhite">{r.fixApplied}</p>
                        </div>
                        <div>
                          <p className="text-muted font-mono text-[10px] uppercase mb-1">Description</p>
                          <p className="text-muted mb-2">{r.faultDescription}</p>
                          <div className="flex flex-wrap gap-2 text-[11px] font-mono text-muted">
                            <span className="chip border-dim">parts {inr(r.partsCostINR)}</span>
                            <span className="chip border-dim">labour {r.laborHours}h · {inr(r.laborCostINR)}</span>
                            <span className="chip border-dim">tech {r.technicianId}</span>
                            <span className="chip border-dim">id {r.id}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!data && <p className="text-center text-muted text-sm py-8">Loading incidents…</p>}
        {data && data.rows.length === 0 && <p className="text-center text-muted text-sm py-8">No incidents match these filters.</p>}
      </div>

      {/* Pagination */}
      {data && (
        <div className="flex items-center justify-between mt-3 text-xs font-mono text-muted">
          <span>page {data.page} of {data.pages} · {num(data.total)} records</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage(1)} className="btn btn-ghost !py-1 !px-2 !text-xs">« first</button>
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn btn-ghost !py-1 !px-2 !text-xs">← prev</button>
            <button disabled={page >= data.pages} onClick={() => setPage(page + 1)} className="btn btn-ghost !py-1 !px-2 !text-xs">next →</button>
            <button disabled={page >= data.pages} onClick={() => setPage(data.pages)} className="btn btn-ghost !py-1 !px-2 !text-xs">last »</button>
          </div>
        </div>
      )}
    </main>
  );
}

function Sel({ label, value, onChange, options, allowEmpty = true }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; allowEmpty?: boolean;
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-xs font-mono text-muted">{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="bg-ink border border-dim rounded-lg px-2 py-1 text-xs font-mono">
        {allowEmpty && <option value="">all</option>}
        {options.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
      </select>
    </label>
  );
}
