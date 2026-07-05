'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Asset dossier — everything known about one machine across 15 years: header
// stats, a failure-mode donut, an MTTR/MTBF-over-time chart, and the full
// paginated incident history. "Report fault" deep-links into the live
// Operations flow for this asset. All data from /api/assets/[id].
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, ComposedChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Legend,
} from 'recharts';
import { api, usePoll } from '@/lib/client';
import { RequireAuth } from '@/components/RequireAuth';
import type { AssetDossier } from '@/lib/analytics';
import { CHART, compactINR, inr, num, shortDate, SEVERITY_CHIP, HEALTH_CHIP, TREND_ARROW, TREND_COLOR } from '@/lib/format';

const TIP = { backgroundColor: '#0D1B3E', border: '1px solid #1E3A5F', borderRadius: 8, fontSize: 12, color: '#E2E8F0' };

export default function AssetPage() {
  const params = useParams<{ id: string }>();
  return <RequireAuth>{() => <Dossier id={params.id} />}</RequireAuth>;
}

function Dossier({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const { data, error } = usePoll<AssetDossier & { incidentPage: { page: number; pageSize: number; total: number; pages: number } }>(
    `/api/assets/${id}?page=${page}&pageSize=15`, 60_000);
  const [reporting, setReporting] = useState(false);

  if (error) return <main className="mx-auto max-w-3xl px-4 pt-20 text-center text-danger">{error}</main>;
  if (!data) return <main className="mx-auto max-w-7xl px-4 py-6 text-muted">Loading dossier…</main>;

  const s = data.summary;
  const reportFault = async () => {
    setReporting(true);
    try {
      const top = data.failureModes[0]?.faultCode ?? 'VIB-201';
      await api<{ runId: string }>('/api/faults', {
        method: 'POST',
        body: JSON.stringify({
          equipmentId: s.id, equipmentType: s.type, plantId: s.plantId,
          faultCode: top, severity: 'high', reportedBy: 'operator',
          description: `Operator-reported fault on ${s.id} (${s.name}); recurring ${top} signature — dispatching Sentinel for a grounded runbook.`,
        }),
      });
      location.href = '/';
    } catch (e) { alert(String((e as Error).message)); setReporting(false); }
  };

  const timeSeries = data.mtbfSeries.map((m) => ({
    year: m.year, mtbfDays: m.mtbfDays, incidents: m.incidents,
    avgMttr: data.mttrSeries.find((x) => x.year === m.year)?.avgMttr ?? null,
  }));

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-5">
        <div>
          <a href="/fleet" className="text-xs text-muted hover:text-teal font-mono">← fleet</a>
          <h1 className="text-2xl font-bold mt-1">{s.id} <span className={`chip align-middle ml-2 ${HEALTH_CHIP(s.health)}`}>health {s.health}%</span></h1>
          <p className="text-muted text-sm">{s.name} · <span className="font-mono">{s.plantId}</span> · tier {s.tier} · installed {shortDate(s.installDate)}</p>
        </div>
        <button onClick={reportFault} disabled={reporting} className="btn btn-teal">⚡ Report fault → Operations</button>
      </div>

      {/* Header stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <Kpi label="incidents (15y)" value={num(s.incidentCount)} />
        <Kpi label="MTBF" value={`${s.mtbfDays}d`} />
        <Kpi label="downtime" value={`${num(data.totals.downtimeHours)}h`} />
        <Kpi label="total cost" value={compactINR(data.totals.costINR)} tone="amber" />
        <Kpi label="₹ saved by flywheel" value={compactINR(data.totals.savedINR)} tone="teal" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        {/* Failure-mode donut */}
        <div className="panel p-4">
          <h3 className="font-semibold text-sm mb-2">Failure modes <span className="text-muted font-normal">· {data.failureModes.length} distinct</span></h3>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="55%" height={220}>
              <PieChart>
                <Pie data={data.failureModes} dataKey="count" nameKey="faultCode" innerRadius={45} outerRadius={85} paddingAngle={2}>
                  {data.failureModes.map((_, i) => <Cell key={i} fill={CHART.categorical[i % CHART.categorical.length]} stroke="#0A0F1E" />)}
                </Pie>
                <Tooltip contentStyle={TIP} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="text-xs space-y-1 flex-1">
              {data.failureModes.slice(0, 8).map((f, i) => (
                <li key={f.faultCode} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm inline-block" style={{ background: CHART.categorical[i % CHART.categorical.length] }} />
                    <span className="font-mono text-offwhite">{f.faultCode}</span>
                  </span>
                  <span className="text-muted">{f.count}× · {f.avgMttr}m</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* MTTR / MTBF over time */}
        <div className="panel p-4">
          <h3 className="font-semibold text-sm mb-2">MTTR &amp; MTBF over time <span className="text-muted font-normal">· the flywheel on one asset</span></h3>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={timeSeries} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="year" stroke={CHART.axis} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="l" stroke={CHART.teal} tick={{ fontSize: 11 }} />
              <YAxis yAxisId="r" orientation="right" stroke={CHART.blue} tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={TIP} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="r" dataKey="incidents" name="incidents" fill={CHART.grid} radius={[2, 2, 0, 0]} />
              <Line yAxisId="l" type="monotone" dataKey="avgMttr" name="avg MTTR (min)" stroke={CHART.teal} strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="r" type="monotone" dataKey="mtbfDays" name="MTBF (days)" stroke={CHART.blue} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Incident history */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Incident history <span className="text-muted font-normal">· {num(data.incidentPage.total)} records</span></h3>
          <Pager page={data.incidentPage.page} pages={data.incidentPage.pages} onPage={setPage} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[720px]">
            <thead>
              <tr className="text-left text-muted font-mono border-b border-dim/60">
                <th className="px-2 py-2">date</th><th className="px-2 py-2">fault</th><th className="px-2 py-2">severity</th>
                <th className="px-2 py-2">root cause → fix</th><th className="px-2 py-2 text-right">MTTR</th>
                <th className="px-2 py-2">tech</th><th className="px-2 py-2 text-right">downtime ₹</th>
              </tr>
            </thead>
            <tbody>
              {data.incidents.map((r) => (
                <tr key={r.id} className="border-b border-dim/30 align-top">
                  <td className="px-2 py-2 font-mono text-muted/80 whitespace-nowrap">{shortDate(r.timestamp)}</td>
                  <td className="px-2 py-2 font-mono text-teal">{r.faultCode}</td>
                  <td className="px-2 py-2"><span className={`chip ${SEVERITY_CHIP[r.severity]}`}>{r.severity}</span> {r.outcome === 'escalated' && <span className="chip border-danger/50 text-danger ml-1">esc</span>}</td>
                  <td className="px-2 py-2 text-muted max-w-[360px]"><span className="text-offwhite/90">{r.rootCause}</span> → {r.fixApplied}</td>
                  <td className="px-2 py-2 text-right font-mono text-muted">{r.mttrMinutes}m</td>
                  <td className="px-2 py-2 font-mono text-muted/80">{r.technicianId}</td>
                  <td className="px-2 py-2 text-right font-mono text-muted/80">{inr(r.downtimeCostINR)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

function Kpi({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'teal' | 'amber' }) {
  return (
    <div className="panel p-3 text-center">
      <p className={`text-xl font-bold ${tone === 'amber' ? 'text-amber' : tone === 'teal' ? 'text-teal' : 'text-offwhite'}`}>{value}</p>
      <p className="text-[10px] font-mono text-muted uppercase mt-0.5">{label}</p>
    </div>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center gap-2 text-xs font-mono">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="btn btn-ghost !py-1 !px-2 !text-xs">←</button>
      <span className="text-muted">{page} / {pages}</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="btn btn-ghost !py-1 !px-2 !text-xs">→</button>
    </div>
  );
}
