'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Fleet — the "we run a real fleet" first impression. All ~60 assets with
// history-derived health, trend, MTBF and open work-orders; filter by plant/type;
// click through to the asset dossier. Everything comes from /api/assets.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react';
import { usePoll } from '@/lib/client';
import { RequireAuth } from '@/components/RequireAuth';
import type { AssetSummary } from '@/lib/analytics';
import { HEALTH_CHIP, TREND_ARROW, TREND_COLOR, shortDate } from '@/lib/format';

export default function FleetPage() {
  return <RequireAuth>{() => <Fleet />}</RequireAuth>;
}

function Fleet() {
  const { data } = usePoll<{ assets: AssetSummary[] }>('/api/assets', 30_000);
  const [plant, setPlant] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState<'health' | 'mtbf' | 'incidents'>('health');

  const assets = data?.assets ?? [];
  const plants = useMemo(() => [...new Set(assets.map((a) => a.plantId))].sort(), [assets]);
  const types = useMemo(() => [...new Set(assets.map((a) => a.type))].sort(), [assets]);

  const rows = useMemo(() => {
    let r = assets.filter((a) => (!plant || a.plantId === plant) && (!type || a.type === type));
    r = [...r].sort((a, b) =>
      sort === 'mtbf' ? b.mtbfDays - a.mtbfDays
      : sort === 'incidents' ? b.incidentCount - a.incidentCount
      : a.health - b.health);
    return r;
  }, [assets, plant, type, sort]);

  const avgHealth = rows.length ? Math.round(rows.reduce((s, a) => s + a.health, 0) / rows.length) : 0;
  const openWO = rows.reduce((s, a) => s + a.openWorkOrders, 0);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold">Fleet</h1>
          <p className="text-muted text-sm">{assets.length} assets across {plants.length} plants · health &amp; MTBF derived from 15 years of incident history</p>
        </div>
        <div className="flex gap-3">
          <Stat label="assets" value={rows.length} />
          <Stat label="avg health" value={`${avgHealth}%`} />
          <Stat label="open WOs" value={openWO} tone={openWO > 0 ? 'amber' : 'teal'} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
        <Select value={plant} onChange={setPlant} label="plant" options={['', ...plants]} />
        <Select value={type} onChange={setType} label="type" options={['', ...types]} />
        <Select value={sort} onChange={(v) => setSort(v as typeof sort)} label="sort" options={['health', 'mtbf', 'incidents']} />
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-muted font-mono text-xs border-b border-dim/60">
              <th className="px-3 py-2">asset</th>
              <th className="px-3 py-2">plant</th>
              <th className="px-3 py-2">type</th>
              <th className="px-3 py-2 text-right">health</th>
              <th className="px-3 py-2 text-center">90d</th>
              <th className="px-3 py-2 text-right">MTBF</th>
              <th className="px-3 py-2 text-right">incidents</th>
              <th className="px-3 py-2 text-right">open WO</th>
              <th className="px-3 py-2">last fault</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="border-b border-dim/30 hover:bg-dim/20 cursor-pointer"
                onClick={() => { location.href = `/assets/${a.id}`; }}>
                <td className="px-3 py-2">
                  <a href={`/assets/${a.id}`} className="text-offwhite font-semibold hover:text-teal">{a.id}</a>
                  <p className="text-[11px] text-muted truncate max-w-[240px]">{a.name}</p>
                </td>
                <td className="px-3 py-2 font-mono text-muted">{a.plantId}</td>
                <td className="px-3 py-2 text-muted text-xs">{a.type.replace(/_/g, ' ')}</td>
                <td className="px-3 py-2 text-right"><span className={`chip ${HEALTH_CHIP(a.health)}`}>{a.health}%</span></td>
                <td className={`px-3 py-2 text-center ${TREND_COLOR[a.trend]}`}>{TREND_ARROW[a.trend]}</td>
                <td className="px-3 py-2 text-right font-mono text-muted">{a.mtbfDays}d</td>
                <td className="px-3 py-2 text-right font-mono text-muted">{a.incidentCount}</td>
                <td className={`px-3 py-2 text-right font-mono ${a.openWorkOrders > 0 ? 'text-amber' : 'text-muted/50'}`}>{a.openWorkOrders || '—'}</td>
                <td className="px-3 py-2 text-xs">
                  {a.lastIncident ? (
                    <span><span className="font-mono text-teal">{a.lastIncident.faultCode}</span> <span className="text-muted/70">{shortDate(a.lastIncident.timestamp)}</span></span>
                  ) : <span className="text-muted/50">none</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data && <p className="text-center text-muted text-sm py-8">Loading fleet…</p>}
        {data && rows.length === 0 && <p className="text-center text-muted text-sm py-8">No assets match the filter.</p>}
      </div>
    </main>
  );
}

function Stat({ label, value, tone = 'teal' }: { label: string; value: string | number; tone?: 'teal' | 'amber' }) {
  return (
    <div className="panel px-4 py-2 text-center">
      <p className={`text-lg font-bold ${tone === 'amber' ? 'text-amber' : 'text-teal'}`}>{value}</p>
      <p className="text-[10px] font-mono text-muted uppercase">{label}</p>
    </div>
  );
}

function Select({ value, onChange, label, options }: { value: string; onChange: (v: string) => void; label: string; options: string[] }) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-xs font-mono text-muted">{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="bg-ink border border-dim rounded-lg px-2 py-1 text-xs font-mono">
        {options.map((o) => <option key={o} value={o}>{o === '' ? 'all' : o.replace(/_/g, ' ')}</option>)}
      </select>
    </label>
  );
}
