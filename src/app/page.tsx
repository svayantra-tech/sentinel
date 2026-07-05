'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Operations dashboard — the demo stage.
// Login → fleet grid → inject fault → watch the 11-state run unfold live:
// Qdrant retrieval (with filters shown), scorer gate, the Enkrypt ⛔ BLOCKED
// moment, suspend → approval → post-mortem → memory write-back.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { api, usePoll, useSession, type ClientUser } from '@/lib/client';
import type { SentinelRunView } from '@/lib/types';
import type { AssetSummary } from '@/lib/analytics';
import { HEALTH_CHIP, TREND_ARROW, TREND_COLOR, num } from '@/lib/format';

interface FleetItem {
  equipmentId: string; equipmentType: string; plantId: string; name: string; health: number;
  preset: { faultCode: string; severity: string; reportedBy: string; description: string };
}

const STAGES = [
  'FAULT_INGESTED', 'CONTEXT_RETRIEVED', 'RUNBOOK_DRAFTED', 'SCORED',
  'SAFETY_CHECKED', 'SUSPENDED', 'TECHNICIAN_APPROVED', 'EXECUTING',
  'POST_MORTEM', 'MEMORY_WRITTEN', 'DONE',
] as const;

export default function OpsPage() {
  const { user, ready, logout } = useSession();
  if (!ready) return null;
  if (!user) return <Login />;
  return <Dashboard user={user} logout={logout} />;
}

// ── Login ────────────────────────────────────────────────────────────────────
function Login() {
  const { data } = usePoll<{ users: Array<{ sub: string; name: string; authLevel: number }>; hint: string }>('/api/auth/login', 60_000);
  const [userId, setUserId] = useState('T-0871');
  const [password, setPassword] = useState('sentinel-demo');
  const [err, setErr] = useState('');

  const login = async () => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      localStorage.setItem('sentinel_token', json.token);
      localStorage.setItem('sentinel_user', JSON.stringify(json.user));
      location.reload();
    } catch (e) { setErr(String((e as Error).message)); }
  };

  return (
    <main className="mx-auto max-w-md px-4 pt-20">
      <div className="panel p-8">
        <div className="flex items-center gap-2 mb-1">
          <span className="h-2 w-2 rounded-full bg-teal led" />
          <h1 className="text-xl font-bold">Sentinel Access</h1>
        </div>
        <p className="text-muted text-sm mb-6">JWT-authenticated. Role &amp; auth-level claims gate what the agent may retrieve for you.</p>
        <label className="text-xs text-muted font-mono">OPERATOR</label>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}
          className="w-full mt-1 mb-4 bg-ink border border-dim rounded-lg px-3 py-2 text-sm">
          {(data?.users ?? [{ sub: 'T-0871', name: 'Priya (Sr. Technician L2)', authLevel: 2 }]).map((u) => (
            <option key={u.sub} value={u.sub}>{u.name} — {u.sub}</option>
          ))}
        </select>
        <label className="text-xs text-muted font-mono">PASSWORD</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full mt-1 mb-2 bg-ink border border-dim rounded-lg px-3 py-2 text-sm" />
        <p className="text-[11px] text-muted/70 mb-4 font-mono">{data?.hint ?? 'password: sentinel-demo'}</p>
        {err && <p className="text-danger text-sm mb-3">{err}</p>}
        <button onClick={login} className="btn btn-teal w-full">Authenticate</button>
      </div>
    </main>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ user, logout }: { user: ClientUser; logout: () => void }) {
  const { data: fleetData } = usePoll<{ fleet: FleetItem[] }>('/api/fleet', 30_000);
  const { data: assetsData } = usePoll<{ assets: AssetSummary[] }>('/api/assets', 30_000);
  const { data: runsData, refresh } = usePoll<{ runs: SentinelRunView[] }>('/api/runs', 1500);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const runs = runsData?.runs ?? [];
  const active = runs.find((r) => r.runId === activeRunId) ?? runs[0] ?? null;

  const assets = assetsData?.assets ?? [];
  const heroIds = new Set((fleetData?.fleet ?? []).map((f) => f.equipmentId));
  const fleetSize = assets.length;
  const avgHealth = assets.length ? Math.round(assets.reduce((s, a) => s + a.health, 0) / assets.length) : 0;
  const openWO = assets.reduce((s, a) => s + a.openWorkOrders, 0);
  // A few of the most at-risk non-hero assets, to make the real fleet visible.
  const watchlist = assets.filter((a) => !heroIds.has(a.id)).sort((a, b) => a.health - b.health).slice(0, 8);

  const inject = async (item: FleetItem) => {
    const res = await api<{ runId: string }>('/api/faults', {
      method: 'POST',
      body: JSON.stringify({
        equipmentId: item.equipmentId, equipmentType: item.equipmentType,
        plantId: item.plantId, ...item.preset,
      }),
    });
    setActiveRunId(res.runId);
    refresh();
  };

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold">Plant IN-04 · Operations</h1>
          <p className="text-muted text-sm">Signed in as <span className="text-teal">{user.name}</span> (auth L{user.authLevel}) — retrieval is filtered to your level</p>
        </div>
        <button onClick={logout} className="btn btn-ghost">Sign out</button>
      </div>

      {/* Fleet stat strip — the real deployment behind the demo stage */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="panel px-4 py-2"><span className="text-teal font-bold text-lg">{num(fleetSize)}</span> <span className="text-[11px] font-mono text-muted uppercase ml-1">assets</span></div>
        <div className="panel px-4 py-2"><span className="text-teal font-bold text-lg">{avgHealth}%</span> <span className="text-[11px] font-mono text-muted uppercase ml-1">avg health</span></div>
        <div className={`panel px-4 py-2 ${openWO > 0 ? '!border-amber/40' : ''}`}><span className={`font-bold text-lg ${openWO > 0 ? 'text-amber' : 'text-teal'}`}>{openWO}</span> <span className="text-[11px] font-mono text-muted uppercase ml-1">open WOs</span></div>
        <a href="/fleet" className="ml-auto text-sm text-muted hover:text-teal font-mono">View full fleet →</a>
      </div>

      {/* Demo hero assets — one-click fault injection */}
      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        {(fleetData?.fleet ?? []).map((item) => (
          <div key={item.equipmentId} className="panel p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-offwhite">{item.equipmentId}</p>
                <p className="text-muted text-xs mt-0.5">{item.name}</p>
              </div>
              <span className={`chip ${item.health < 65 ? 'border-danger/60 text-danger' : item.health < 75 ? 'border-amber/60 text-amber' : 'border-teal/60 text-teal'}`}>
                health {item.health}%
              </span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="chip border-dim text-muted">{item.equipmentType}</span>
              <span className="chip border-dim text-muted">{item.plantId}</span>
            </div>
            <button onClick={() => inject(item)} className="btn btn-teal w-full mt-4">
              ⚡ Inject fault · {item.preset.faultCode}
            </button>
          </div>
        ))}
      </div>

      {/* Fleet watchlist — lowest-health assets from the full corpus */}
      {watchlist.length > 0 && (
        <div className="panel p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Fleet watchlist <span className="text-muted font-normal">· lowest health across all {fleetSize} assets</span></h3>
            <a href="/fleet" className="text-xs text-muted hover:text-teal font-mono">all assets →</a>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {watchlist.map((a) => (
              <a key={a.id} href={`/assets/${a.id}`} className="rounded-lg bg-ink/60 border border-dim/60 p-3 hover:border-teal/50 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-offwhite">{a.id}</span>
                  <span className={`chip ${HEALTH_CHIP(a.health)}`}>{a.health}%</span>
                </div>
                <p className="text-[11px] text-muted mt-1">{a.plantId} · {a.type.replace(/_/g, ' ')} <span className={TREND_COLOR[a.trend]}>{TREND_ARROW[a.trend]}</span></p>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Run theatre */}
      {active ? <RunTheatre run={active} allRuns={runs} onSelect={setActiveRunId} /> : (
        <div className="panel p-10 text-center text-muted">
          Inject a fault above — the full agent loop will unfold here in real time.
        </div>
      )}
    </main>
  );
}

function RunTheatre({ run, allRuns, onSelect }: {
  run: SentinelRunView; allRuns: SentinelRunView[]; onSelect: (id: string) => void;
}) {
  const stageIdx = STAGES.indexOf(run.stage as (typeof STAGES)[number]);
  const blocked = run.safety?.violations.filter((v) => v.severity === 'block') ?? [];

  return (
    <div className="space-y-4">
      {/* Run selector + stepper */}
      <div className="panel p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${run.stage === 'DONE' ? 'bg-teal' : run.stage === 'FAILED' ? 'bg-danger' : 'bg-amber led'}`} />
            <span className="font-mono text-sm text-offwhite">{run.runId.slice(0, 8)}…</span>
            <span className="chip border-dim text-muted">{run.correlationId}</span>
            <span className="chip border-teal/50 text-teal">{run.fault.equipmentId} · {run.fault.faultCode}</span>
            {run.workOrderId && <span className="chip border-dim text-muted">CMMS {run.workOrderId}</span>}
          </div>
          {allRuns.length > 1 && (
            <select value={run.runId} onChange={(e) => onSelect(e.target.value)}
              className="bg-ink border border-dim rounded-lg px-2 py-1 text-xs font-mono">
              {allRuns.map((r) => (
                <option key={r.runId} value={r.runId}>{r.fault.equipmentId} · {r.stage} · {r.runId.slice(0, 6)}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          {STAGES.map((s, i) => (
            <div key={s} className="flex-1 min-w-[64px]">
              <div className={`h-1.5 rounded-full ${i <= stageIdx ? (s === 'SUSPENDED' && run.stage === 'SUSPENDED' ? 'bg-amber' : 'bg-teal') : 'bg-dim'}`} />
              <p className={`text-[9px] mt-1 font-mono truncate ${i <= stageIdx ? 'text-offwhite' : 'text-muted/50'}`}>{s.replace(/_/g, ' ')}</p>
            </div>
          ))}
        </div>
        {run.stage === 'SUSPENDED' && (
          <div className="mt-3 rounded-lg border border-amber/60 bg-amber/10 px-4 py-2.5 text-amber text-sm flex items-center justify-between">
            <span>⏸ Mastra workflow suspended — human approval required before any physical work.</span>
            <a href="/technician" className="btn btn-ghost !py-1 !px-3 !text-amber !border-amber/60">Open Technician view →</a>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Qdrant context */}
        {run.context && (
          <div className="panel p-4">
            <h3 className="font-semibold text-sm mb-1">Institutional memory <span className="text-muted font-normal">· Qdrant retrieval</span></h3>
            {(() => {
              const years = run.context!.incidents.map((i) => Number(i.payload.timestamp.slice(0, 4))).filter(Boolean);
              const span = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '';
              return years.length ? (
                <p className="text-[11px] text-teal mb-1">↳ {run.context!.incidents.length} similar incidents surfaced from {span} — across a 15-year corpus of {'~'}3,000 records.</p>
              ) : null;
            })()}
            <p className="text-[11px] font-mono text-muted mb-3">
              semantic search + hard filters: {Object.entries(run.context.filters).map(([k, v]) => `${k}=${v}`).join(' · ')}
            </p>
            <div className="space-y-2">
              {run.context.incidents.map((i, n) => (
                <div key={n} className="rounded-lg bg-ink/60 border border-dim/60 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-teal">{i.payload.equipment_id} @ {i.payload.plant_id} · {i.payload.fault_code}</span>
                    <span className="chip border-teal/40 text-teal">{(i.score * 100).toFixed(0)}% match</span>
                  </div>
                  <p className="text-xs text-muted line-clamp-2">{i.payload.root_cause} → {i.payload.fix_applied}</p>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 pt-1">
                {run.context.manualChunks.map((m, n) => (
                  <span key={n} className={`chip ${m.payload.section_type === 'lockout_tagout' ? 'border-amber/60 text-amber' : 'border-dim text-muted'}`}>
                    OEM {m.payload.chapter} · {m.payload.section_type}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Scorecard */}
        {run.scorecard && (
          <div className="panel p-4">
            <h3 className="font-semibold text-sm mb-3">Runbook quality gate <span className="text-muted font-normal">· Mastra scorers (deterministic) · attempt {run.scorecard.attempt}</span></h3>
            <div className="grid grid-cols-3 gap-3">
              {(['relevance', 'safety', 'completeness'] as const).map((k) => (
                <div key={k} className="rounded-lg bg-ink/60 border border-dim/60 p-3 text-center">
                  <p className={`text-2xl font-bold ${run.scorecard![k] >= 0.75 ? 'text-teal' : 'text-danger'}`}>{run.scorecard![k].toFixed(2)}</p>
                  <p className="text-[10px] font-mono text-muted uppercase mt-1">{k}</p>
                </div>
              ))}
            </div>
            {run.scorecard.reasons.length > 0 && (
              <ul className="mt-3 text-[11px] text-muted space-y-1">
                {run.scorecard.reasons.slice(0, 3).map((r, i) => <li key={i}>· {r}</li>)}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Enkrypt gate — the money moment */}
      {run.safety && (
        <div className={`panel p-4 ${blocked.length ? '!border-danger/70' : ''}`}>
          <h3 className="font-semibold text-sm mb-3">
            Safety gate <span className="text-muted font-normal">· Enkrypt AI (cloud {run.safety.cloudUsed ? 'active' : 'offline — local deterministic rules held the line'}) + local physics engine</span>
          </h3>
          {blocked.length === 0 ? (
            <p className="text-teal text-sm">✓ All {run.runbook?.steps.length ?? 0} steps cleared — no hallucinated specs, LOTO ordering verified, authorisation confirmed.</p>
          ) : (
            <div className="space-y-3">
              {blocked.map((v, i) => (
                <div key={i} className="rounded-lg border border-danger/70 bg-danger/10 p-4">
                  <p className="font-mono text-danger font-bold text-sm mb-1">⛔ BLOCKED · {v.type}{v.stepN ? ` · step ${v.stepN}` : ''}</p>
                  <p className="text-sm text-offwhite">{v.detail}</p>
                  {v.evidence && <p className="text-[11px] text-muted mt-2 font-mono">OEM evidence: “…{v.evidence.slice(0, 140)}…”</p>}
                  {v.correction && (
                    <p className="text-sm mt-2 text-teal">→ corrected: {v.correction}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Runbook (corrected) */}
      {(run.correctedRunbook ?? run.runbook) && (
        <div className="panel p-4">
          <h3 className="font-semibold text-sm mb-1">{(run.correctedRunbook ?? run.runbook)!.title}</h3>
          <p className="text-xs text-muted mb-3">hypothesis: {(run.correctedRunbook ?? run.runbook)!.faultHypothesis}</p>
          <ol className="space-y-2">
            {(run.correctedRunbook ?? run.runbook)!.steps.map((s) => (
              <li key={s.n} className="flex gap-3 text-sm">
                <span className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${run.safety?.blockedSteps.includes(s.n) ? 'bg-danger/20 text-danger border border-danger/60' : 'bg-teal/15 text-teal border border-teal/40'}`}>{s.n}</span>
                <div>
                  <p className="text-offwhite">{s.action}</p>
                  <p className="text-[11px] text-muted">verify: {s.verification}{s.ppe ? ` · PPE: ${s.ppe}` : ''}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Post-mortem + memory write-back */}
      {run.postMortem && (
        <div className="panel p-4">
          <h3 className="font-semibold text-sm mb-2">
            Post-mortem <span className="text-muted font-normal">· bias-gated{run.postMortemSafety?.violations.some((v) => v.type === 'BLAME_BIAS') ? ' — blame language reframed by Enkrypt Mode 3' : ''}</span>
          </h3>
          <pre className="text-xs text-muted whitespace-pre-wrap font-mono bg-ink/60 rounded-lg p-3 border border-dim/60">{run.postMortem}</pre>
          {run.memoryPointId && (
            <p className="text-teal text-xs mt-3 font-mono">
              ✓ upserted to Qdrant incident_history ({run.memoryPointId.slice(0, 8)}…) — inject the same fault again and watch this fix appear in retrieval. The flywheel is live.
            </p>
          )}
        </div>
      )}

      {/* Timeline */}
      <div className="panel p-4">
        <h3 className="font-semibold text-sm mb-3">Run timeline <span className="text-muted font-normal">· every transition audited</span></h3>
        <div className="space-y-1.5">
          {run.timeline.map((t, i) => (
            <div key={i} className="flex gap-3 text-xs">
              <span className="font-mono text-muted/70 shrink-0">{new Date(t.at).toLocaleTimeString()}</span>
              <span className="font-mono text-teal shrink-0 w-44">{t.stage}</span>
              <span className="text-muted">{t.note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
