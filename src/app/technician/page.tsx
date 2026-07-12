'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Technician view — the HITL surface (FR-08). Mobile-framed on purpose: this
// is what the person on the factory floor sees. Suspended runs appear as an
// approval inbox; blocked instructions are hidden and replaced by the safety
// warning + corrected step. Approve → Mastra resume → execution proceeds.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { api, usePoll, useSession } from '@/lib/client';
import ResetDemoButton from '@/components/ResetDemoButton';
import { requiredApprovalLevel, type SentinelRunView } from '@/lib/types';
import type { TechnicianSummary } from '@/lib/analytics';

export default function TechnicianPage() {
  const { user, ready } = useSession();
  const { data, refresh } = usePoll<{ runs: SentinelRunView[] }>('/api/runs', 1500);
  const { data: techData } = usePoll<{ technician: TechnicianSummary }>(user ? `/api/technicians?id=${user.sub}` : null, 60_000);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  if (!ready) return null;
  if (!user) return (
    <main className="mx-auto max-w-md px-4 pt-20 text-center text-muted">
      <p>Sign in on the <a href="/" className="text-teal underline">Operations</a> page first.</p>
    </main>
  );

  const suspended = (data?.runs ?? []).filter((r) => r.stage === 'SUSPENDED');
  const recent = (data?.runs ?? []).filter((r) => r.stage !== 'SUSPENDED').slice(0, 4);

  const decide = async (runId: string, approved: boolean) => {
    setBusy(runId);
    try {
      await api(`/api/runs/${runId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ approved, notes: notes || undefined }),
      });
      setNotes('');
      refresh();
    } finally { setBusy(null); }
  };

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      {/* Phone frame */}
      <div className="rounded-[2rem] border-2 border-dim bg-navy p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="font-bold">Approvals</p>
            <p className="text-[11px] text-muted">{user.name} · auth L{user.authLevel}</p>
          </div>
          <div className="flex items-center gap-2">
            <ResetDemoButton onReset={refresh} className="chip border-dim text-muted hover:text-offwhite hover:border-teal" />
            <span className={`chip ${suspended.length ? 'border-amber/60 text-amber' : 'border-teal/50 text-teal'}`}>
              {suspended.length ? `${suspended.length} waiting` : 'inbox clear'}
            </span>
          </div>
        </div>

        {/* Signed-in technician's derived lifetime record */}
        {techData?.technician && (
          <div className="rounded-xl bg-ink/60 border border-dim/60 p-3 mb-4">
            <p className="text-[10px] font-mono text-muted uppercase mb-2">lifetime record · {techData.technician.specialization}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div><p className="text-lg font-bold text-teal">{techData.technician.resolutions}</p><p className="text-[9px] font-mono text-muted uppercase">resolved</p></div>
              <div><p className="text-lg font-bold text-teal">{techData.technician.avgMttr}m</p><p className="text-[9px] font-mono text-muted uppercase">avg MTTR</p></div>
              <div><p className={`text-lg font-bold ${techData.technician.escalations ? 'text-amber' : 'text-teal'}`}>{techData.technician.escalations}</p><p className="text-[9px] font-mono text-muted uppercase">escalated</p></div>
            </div>
            {techData.technician.topAssets.length > 0 && (
              <p className="text-[10px] text-muted/70 mt-2 text-center font-mono">top assets: {techData.technician.topAssets.map((a) => a.id).join(' · ')}</p>
            )}
          </div>
        )}

        {suspended.length === 0 && (
          <div className="rounded-xl bg-ink/60 border border-dim/60 p-6 text-center text-muted text-sm">
            No runs awaiting approval. Inject a fault from Operations.
          </div>
        )}

        {suspended.map((run) => {
          const rb = run.correctedRunbook ?? run.runbook;
          const blocked = run.safety?.violations.filter((v) => v.severity === 'block') ?? [];
          const required = requiredApprovalLevel(run);
          const canApprove = user.authLevel >= required;
          return (
            <div key={run.runId} className="rounded-xl bg-ink/60 border border-amber/50 p-4 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="h-2 w-2 rounded-full bg-amber led" />
                <p className="text-sm font-semibold">{run.fault.equipmentId} · {run.fault.faultCode}</p>
              </div>
              <p className="text-[11px] text-muted mb-3">{run.fault.description}</p>

              {blocked.length > 0 && (
                <div className="rounded-lg border border-danger/70 bg-danger/10 p-3 mb-3">
                  <p className="font-mono text-danger text-[11px] font-bold mb-1">⛔ {blocked.length} INSTRUCTION(S) BLOCKED BY SAFETY GATE</p>
                  {blocked.map((v, i) => (
                    <p key={i} className="text-[11px] text-offwhite mb-1">
                      {v.type}{v.stepN ? ` (step ${v.stepN})` : ''}: shown below already corrected.
                    </p>
                  ))}
                </div>
              )}

              <ol className="space-y-1.5 mb-3">
                {rb?.steps.map((s) => (
                  <li key={s.n} className="text-[12px] flex gap-2">
                    <span className={`shrink-0 font-mono ${run.safety?.blockedSteps.includes(s.n) ? 'text-danger' : 'text-teal'}`}>{s.n}.</span>
                    <span className="text-offwhite">{s.action}</span>
                  </li>
                ))}
              </ol>

              <p className="text-[10px] text-muted mb-1 font-mono">est. {rb?.estimatedMinutes} min · scorer relevance {run.scorecard?.relevance} / safety {run.scorecard?.safety} / completeness {run.scorecard?.completeness}</p>

              {!canApprove && (
                <div className="rounded-lg border border-amber/50 bg-amber/10 p-2.5 mb-3 text-[11px] text-amber">
                  🔒 Requires L{required}+ sign-off — this is safety-critical work. You are L{user.authLevel}. A senior technician or supervisor must approve; you may reject or escalate.
                </div>
              )}
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="notes (optional)"
                className="w-full bg-navy border border-dim rounded-lg px-3 py-2 text-xs mb-3" />
              <div className="flex gap-2">
                <button disabled={busy === run.runId || !canApprove} title={canApprove ? '' : `Requires L${required}+`}
                  onClick={() => decide(run.runId, true)}
                  className={`btn flex-1 ${canApprove ? 'btn-teal' : 'btn-ghost opacity-50 cursor-not-allowed'}`}>
                  ✓ Approve &amp; resume
                </button>
                <button disabled={busy === run.runId} onClick={() => decide(run.runId, false)} className="btn btn-danger flex-1">
                  ✕ Reject
                </button>
              </div>
              <p className="text-[10px] text-muted/70 mt-2 text-center font-mono">
                {canApprove ? 'approval resumes the suspended Mastra workflow' : `L${required}+ required to authorise · you are L${user.authLevel}`}
              </p>
            </div>
          );
        })}

        {recent.length > 0 && (
          <div className="mt-2">
            <p className="text-[11px] font-mono text-muted mb-2">RECENT</p>
            {recent.map((r) => (
              <div key={r.runId} className="flex items-center justify-between text-[11px] py-1.5 border-t border-dim/40">
                <span className="text-offwhite">{r.fault.equipmentId} · {r.fault.faultCode}</span>
                <span className={`font-mono ${r.stage === 'DONE' ? 'text-teal' : r.stage === 'FAILED' ? 'text-danger' : 'text-amber'}`}>{r.stage}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
