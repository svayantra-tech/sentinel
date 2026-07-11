'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Insights — the executive dashboard and the centrepiece for judges. Fifteen
// years of maintenance data made legible: the ⭐ MTTR-trend chart (slopes down)
// is the whole thesis in one line — every fault makes the plant faster. All
// data from /api/analytics.
// ─────────────────────────────────────────────────────────────────────────────
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell,
} from 'recharts';
import { usePoll } from '@/lib/client';
import { RequireAuth } from '@/components/RequireAuth';
import type { OrgAnalytics } from '@/lib/analytics';
import { CHART, compactINR, num } from '@/lib/format';

const TIP = { backgroundColor: '#0D1B3E', border: '1px solid #1E3A5F', borderRadius: 8, fontSize: 12, color: '#E2E8F0' };

export default function AnalyticsPage() {
  return <RequireAuth>{() => <Insights />}</RequireAuth>;
}

function Insights() {
  // Ask for the Qdrant-scrolled source; the API falls back to the array (and
  // says so via `source`) when no cluster is configured.
  const { data } = usePoll<OrgAnalytics>('/api/analytics?source=qdrant', 60_000);
  if (!data) return <main className="mx-auto max-w-7xl px-4 py-6 text-muted">Loading 15 years of data…</main>;
  const k = data.kpis;
  const sourceCaption = data.source === 'qdrant'
    ? `source: Qdrant · ${num(data.pointsScrolled)} points scrolled`
    : `source: in-memory store · ${num(data.pointsScrolled)} incidents`;

  // Thin the monthly series labels to years for a readable axis.
  const monthly = data.incidentsPerMonth.map((m) => ({ ...m, label: m.month.endsWith('-01') ? m.month.slice(0, 4) : '' }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Insights</h1>
        <p className="text-muted text-sm">Plant reliability, 2011 → 2025 · {num(k.fleetSize)} assets · {k.plants} plants · derived live from the 15-year <span className="text-offwhite">synthesized</span> incident corpus (modeled on real-world failure modes)</p>
        <p className="text-[11px] font-mono mt-1"><span className={`chip ${data.source === 'qdrant' ? 'border-[#7aa2ff]/50 text-[#7aa2ff]' : 'border-dim text-muted'}`}>{sourceCaption}</span></p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Kpi label="incidents resolved" value={num(k.incidentsResolved)} sub="15-year total" />
        <Kpi label="downtime hours prevented" value={num(k.downtimeHoursPrevented)} sub="vs 2011 baseline MTTR" tone="teal" />
        <Kpi label="₹ saved" value={compactINR(k.rupeesSaved)} sub="faster resolution × downtime rate" tone="teal" />
        <Kpi label="avg MTTR 2011 → 2025" value={`${k.avgMttr2011} → ${k.avgMttrNow}m`} sub={`${k.mttrImprovementPct}% faster`} tone="amber" />
      </div>

      {/* ⭐ The flywheel chart */}
      <div className="panel p-4 mb-4 border-teal/40">
        <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
          <h3 className="font-semibold text-sm">⭐ Mean time-to-resolve, by year</h3>
          <span className="text-teal text-xs font-mono">{k.mttrImprovementPct}% faster since 2011</span>
        </div>
        <p className="text-[11px] text-muted mb-3">Institutional-memory flywheel — every resolved fault becomes retrievable context, so the next one resolves faster. The slope <span className="text-teal">is</span> the thesis.</p>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data.mttrTrend} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="year" stroke={CHART.axis} tick={{ fontSize: 11 }} />
            <YAxis stroke={CHART.axis} tick={{ fontSize: 11 }} domain={[0, 'dataMax + 20']} unit="m" />
            <Tooltip contentStyle={TIP} formatter={(v: number) => [`${v} min`, 'avg MTTR']} />
            <ReferenceLine y={k.avgMttr2011} stroke={CHART.amber} strokeDasharray="4 4" label={{ value: '2011 baseline', fill: CHART.amber, fontSize: 10, position: 'insideTopLeft' }} />
            <Line type="monotone" dataKey="avgMttr" stroke={CHART.teal} strokeWidth={3} dot={{ r: 3, fill: CHART.teal }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Incidents per month */}
      <div className="panel p-4 mb-4">
        <h3 className="font-semibold text-sm mb-3">Incidents per month <span className="text-muted font-normal">· 180 months of operations</span></h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={monthly} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <defs>
              <linearGradient id="incFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART.blue} stopOpacity={0.5} />
                <stop offset="100%" stopColor={CHART.blue} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" stroke={CHART.axis} tick={{ fontSize: 10 }} interval={0} />
            <YAxis stroke={CHART.axis} tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TIP} labelFormatter={(l, p) => (p && p[0] ? p[0].payload.month : l)} />
            <Area type="monotone" dataKey="count" stroke={CHART.blue} strokeWidth={1.5} fill="url(#incFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        {/* Downtime cost + cumulative savings */}
        <div className="panel p-4">
          <h3 className="font-semibold text-sm mb-3">Downtime cost per year &amp; cumulative savings</h3>
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={data.downtimeCostPerYear.map((d, i) => ({ ...d, saved: data.cumulativeSavings[i].savedINR }))} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="year" stroke={CHART.axis} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="l" stroke={CHART.axis} tick={{ fontSize: 10 }} tickFormatter={(v) => compactINR(v)} width={64} />
              <YAxis yAxisId="r" orientation="right" stroke={CHART.teal} tick={{ fontSize: 10 }} tickFormatter={(v) => compactINR(v)} width={64} />
              <Tooltip contentStyle={TIP} formatter={(v: number) => compactINR(v)} />
              <Bar yAxisId="l" dataKey="costINR" name="downtime cost" fill={CHART.amber} radius={[2, 2, 0, 0]} />
              <Line yAxisId="r" type="monotone" dataKey="saved" name="cumulative saved" stroke={CHART.teal} strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Top failure modes */}
        <div className="panel p-4">
          <h3 className="font-semibold text-sm mb-3">Top failure modes <span className="text-muted font-normal">· by frequency</span></h3>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={data.topFailureModes} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" stroke={CHART.axis} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="faultCode" stroke={CHART.axis} tick={{ fontSize: 11 }} width={64} />
              <Tooltip contentStyle={TIP} formatter={(v: number, n) => [n === 'count' ? `${v} incidents` : `${v} min`, n === 'count' ? 'count' : 'avg MTTR']} />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {data.topFailureModes.map((_, i) => <Cell key={i} fill={CHART.categorical[i % CHART.categorical.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Plant comparison */}
      <div className="panel p-4">
        <h3 className="font-semibold text-sm mb-3">Plant comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-muted font-mono text-xs border-b border-dim/60">
                <th className="px-3 py-2">plant</th><th className="px-3 py-2">region</th>
                <th className="px-3 py-2 text-right">assets</th><th className="px-3 py-2 text-right">incidents</th>
                <th className="px-3 py-2 text-right">avg MTTR</th><th className="px-3 py-2 text-right">15y cost</th>
              </tr>
            </thead>
            <tbody>
              {data.plantComparison.map((p) => (
                <tr key={p.plantId} className="border-b border-dim/30">
                  <td className="px-3 py-2"><span className="font-mono text-offwhite">{p.plantId}</span> <span className="text-muted text-xs">{p.name}</span></td>
                  <td className="px-3 py-2 text-muted text-xs">{p.region}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted">{p.assets}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted">{num(p.incidents)}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted">{p.avgMttr}m</td>
                  <td className="px-3 py-2 text-right font-mono text-amber">{compactINR(p.costINR)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function Kpi({ label, value, sub, tone = 'default' }: { label: string; value: string; sub: string; tone?: 'default' | 'teal' | 'amber' }) {
  return (
    <div className="panel p-4">
      <p className="text-[10px] font-mono text-muted uppercase">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone === 'amber' ? 'text-amber' : tone === 'teal' ? 'text-teal' : 'text-offwhite'}`}>{value}</p>
      <p className="text-[11px] text-muted/70 mt-0.5">{sub}</p>
    </div>
  );
}
