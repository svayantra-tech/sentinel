'use client';
// ─────────────────────────────────────────────────────────────────────────────
// SENTINEL AGENT — "Ambient Autonomy"
// A floating agent that resolves an incident hands-free by orchestrating the
// SAME real APIs a human clicks through: POST /api/faults → poll /api/runs/[id]
// → (visible pause on the real safety block) → POST /api/runs/[id]/approve →
// poll to DONE. Nothing is simulated: every feed line is a real timeline event
// or a real API response, and RBAC is enforced — the agent approves AS the
// logged-in user and stops honestly if their level can't sign off.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import { api, useSession } from '@/lib/client';
import type { SentinelRunView } from '@/lib/types';

interface FleetItem {
  equipmentId: string; equipmentType: string; plantId: string; name: string;
  preset: { faultCode: string; severity: string; reportedBy: string; description: string };
}

type AgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'stopped';
interface FeedLine { at: string; text: string; kind: 'info' | 'ok' | 'block' | 'warn' }

const STAGE_LINES: Record<string, string> = {
  FAULT_INGESTED: 'Fault ingested — opening CMMS work order via MCP…',
  CONTEXT_RETRIEVED: 'Institutional memory retrieved from Qdrant…',
  RUNBOOK_DRAFTED: 'Repair runbook drafted…',
  SCORED: 'Mastra scorers graded the draft…',
  SAFETY_CHECKED: 'Safety gate cross-checked every step…',
  SUSPENDED: 'Workflow suspended at the human-approval gate.',
  TECHNICIAN_APPROVED: 'Approval registered — resuming workflow…',
  EXECUTING: 'Executing corrected runbook…',
  POST_MORTEM: 'Writing blameless post-mortem…',
  MEMORY_WRITTEN: 'Incident written back to memory — the flywheel turns.',
  DONE: 'Resolved.',
  FAILED: 'Run failed.',
};

/** Mirror of requiredApprovalLevel in lib/types (server enforces it regardless). */
function requiredLevel(run: SentinelRunView): number {
  if (run.fault.severity === 'critical') return 3;
  const hadBlock = run.safety?.violations.some((v) => v.severity === 'block') ?? false;
  return run.fault.severity === 'high' || hadBlock ? 2 : 1;
}

export default function SentinelAgent() {
  const { user, ready } = useSession();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [fleet, setFleet] = useState<FleetItem[]>([]);
  const [assetIdx, setAssetIdx] = useState(0);
  const [result, setResult] = useState<{ workOrderId?: string; catches: string[]; seconds: number; memoryPointId?: string; memoryWritten: boolean } | null>(null);
  const cancelled = useRef(false);

  // /about's "Watch the agent work" CTA opens the panel via this event.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('sentinel-agent-open', onOpen);
    return () => window.removeEventListener('sentinel-agent-open', onOpen);
  }, []);

  // Load the REAL fault presets (same ones the Operations buttons send).
  useEffect(() => {
    if (open && user && fleet.length === 0) {
      api<{ fleet: FleetItem[] }>('/api/fleet').then((d) => setFleet(d.fleet)).catch(() => {});
    }
  }, [open, user, fleet.length]);

  const push = (text: string, kind: FeedLine['kind'] = 'info') =>
    setFeed((f) => [...f, { at: new Date().toLocaleTimeString(), text, kind }]);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const getRun = async (id: string): Promise<SentinelRunView> => {
    const d = await api<{ run?: SentinelRunView } & SentinelRunView>(`/api/runs/${id}`);
    return (d.run ?? d) as SentinelRunView;
  };

  const resolveAutonomously = async () => {
    if (!user || status === 'working' || status === 'blocked') return;
    const item = fleet[assetIdx];
    if (!item) { push('Fleet presets not loaded yet — try again in a second.', 'warn'); return; }
    cancelled.current = false;
    setFeed([]); setResult(null); setStatus('working');
    const t0 = Date.now();
    const seen = new Set<string>();

    try {
      push(`Dispatching fault ${item.preset.faultCode} on ${item.equipmentId} (${item.name})…`);
      const { runId } = await api<{ runId: string }>('/api/faults', {
        method: 'POST',
        body: JSON.stringify({ equipmentId: item.equipmentId, equipmentType: item.equipmentType, plantId: item.plantId, ...item.preset }),
      });
      push(`Run ${runId.slice(0, 8)} accepted (202).`, 'ok');

      // Poll the real run; surface each REAL timeline event exactly once.
      let run = await getRun(runId);
      const surfaceTimeline = (r: SentinelRunView) => {
        for (const t of r.timeline) {
          const key = `${t.stage}|${t.note}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const isBlock = t.note.includes('⛔');
          push(t.note || STAGE_LINES[t.stage] || t.stage, isBlock ? 'block' : t.stage === 'FAILED' ? 'warn' : 'info');
        }
      };
      for (let i = 0; i < 120 && !cancelled.current; i++) {
        run = await getRun(runId);
        surfaceTimeline(run);
        if (run.stage === 'SUSPENDED' || run.stage === 'FAILED' || run.stage === 'DONE') break;
        await sleep(1000);
      }
      if (cancelled.current) { push('Agent stopped by user (server-side run continues).', 'warn'); setStatus('stopped'); return; }
      if (run.stage === 'FAILED') { setStatus('stopped'); return; }

      // ── THE CRITICAL BEAT: pause visibly on the real safety block ──────────
      const blocks = (run.safety?.violations ?? []).filter((v) => v.severity === 'block');
      if (blocks.length > 0) {
        setStatus('blocked');
        for (const b of blocks) {
          push(`⛔ Unsafe step detected — ${b.type}: ${b.detail}`, 'block');
          if (b.correction) push(`Correcting per OEM spec → ${b.correction}`, 'ok');
        }
        await sleep(2600); // let the judges SEE the catch
      }
      if (cancelled.current) { setStatus('stopped'); return; }

      // ── RBAC-honest auto-approval as the logged-in user ────────────────────
      if (run.stage === 'SUSPENDED') {
        const need = requiredLevel(run);
        if (user.authLevel < need) {
          push(`This ${blocks.length ? 'safety-corrected' : ''} work requires auth level L${need} to approve — you are ${user.name} (L${user.authLevel}). I won't bypass RBAC: please sign in as L${need}+ and run me again.`, 'warn');
          setStatus('stopped'); return;
        }
        setStatus('working');
        push(`Auto-approving ${blocks.length ? 'the CORRECTED runbook' : 'the runbook'} as ${user.sub} (L${user.authLevel}) via the real approve API…`);
        await api(`/api/runs/${runId}/approve`, { method: 'POST', body: JSON.stringify({ approved: true, notes: 'Auto-approved by Sentinel Agent (Ambient Autonomy) after safety review' }) });
      }

      for (let i = 0; i < 120 && !cancelled.current; i++) {
        run = await getRun(runId);
        surfaceTimeline(run);
        if (run.stage === 'DONE' || run.stage === 'FAILED') break;
        await sleep(1000);
      }
      if (run.stage === 'DONE') {
        const secs = Math.round((Date.now() - t0) / 1000);
        const memoryWritten = run.timeline.some((t) => t.stage === 'MEMORY_WRITTEN') || !!run.memoryPointId;
        push(`Resolved in ${secs}s.`, 'ok');
        setResult({ workOrderId: run.workOrderId, catches: blocks.map((b) => b.type), seconds: secs, memoryPointId: run.memoryPointId, memoryWritten });
        setStatus('done');
      } else {
        setStatus('stopped');
      }
    } catch (e) {
      push(`Agent error: ${(e as Error).message}`, 'warn');
      setStatus('stopped');
    }
  };

  if (!ready) return null;

  const orbClass = status === 'blocked' ? 'orb-alarm' : status === 'working' ? 'orb orb-fast' : 'orb';

  return (
    <>
      {/* Floating presence — always visible when logged in */}
      {user && !open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Sentinel Agent"
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-navy2 border border-teal/50 flex items-center justify-center hover:border-teal"
        >
          <span className={`h-5 w-5 rounded-full bg-teal ${orbClass}`} />
        </button>
      )}

      {open && (
        <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[430px] slide-in">
          <div className="h-full bg-navy border-l border-dim/70 flex flex-col shadow-2xl">
            {/* Header */}
            <div className="px-5 py-4 border-b border-dim/60 flex items-center gap-3">
              <span className={`h-4 w-4 rounded-full ${status === 'blocked' ? 'bg-danger' : 'bg-teal'} ${orbClass}`} />
              <div className="flex-1">
                <div className="font-bold tracking-wide text-offwhite">SENTINEL AGENT</div>
                <div className="text-[11px] font-mono text-muted">Ambient Autonomy — the AI copilot, not a human</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-offwhite text-xl leading-none px-2" aria-label="Close">×</button>
            </div>

            {!user ? (
              <div className="p-6 text-sm text-muted">
                Sign in on the <a href="/" className="text-teal underline">Operations console</a> first — the agent acts with
                <span className="text-offwhite"> your</span> credentials and respects your authorisation level.
              </div>
            ) : (
              <>
                {/* Controls */}
                <div className="px-5 py-4 border-b border-dim/60 space-y-3">
                  <label className="text-[11px] font-mono text-muted uppercase">Asset</label>
                  <select
                    value={assetIdx}
                    onChange={(e) => setAssetIdx(Number(e.target.value))}
                    disabled={status === 'working' || status === 'blocked'}
                    className="w-full bg-ink border border-dim rounded-lg px-3 py-2 text-sm"
                  >
                    {(fleet.length ? fleet : [{ equipmentId: '…', name: 'loading presets…', preset: { faultCode: '' } } as FleetItem]).map((f, i) => (
                      <option key={f.equipmentId} value={i}>{f.equipmentId} — {f.preset.faultCode || '…'}</option>
                    ))}
                  </select>
                  {status === 'working' || status === 'blocked' ? (
                    <button onClick={() => { cancelled.current = true; }} className="btn btn-ghost w-full">Stop watching (run continues)</button>
                  ) : (
                    <button onClick={resolveAutonomously} className="btn btn-teal w-full" disabled={!fleet.length}>
                      ⚡ Resolve incidents autonomously
                    </button>
                  )}
                  <p className="text-[10px] font-mono text-muted/70">
                    Runs the REAL pipeline via the same APIs a human uses — retrieval, draft, scorers, safety gate,
                    then auto-approves as {user.sub} (L{user.authLevel}). RBAC is never bypassed.
                  </p>
                </div>

                {/* Live activity feed */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                  {feed.length === 0 && status === 'idle' && (
                    <p className="text-sm text-muted">Idle. Choose an asset and let the agent handle the incident end-to-end.</p>
                  )}
                  {feed.map((l, i) => (
                    <div key={i} className={`text-[12px] font-mono leading-relaxed flex gap-2 ${l.kind === 'block' ? 'block-shake' : ''}`}>
                      <span className="text-muted/60 shrink-0">{l.at}</span>
                      <span className={
                        l.kind === 'block' ? 'text-danger font-bold' :
                        l.kind === 'ok' ? 'text-teal' :
                        l.kind === 'warn' ? 'text-amber' : 'text-offwhite/90'
                      }>{l.text}</span>
                    </div>
                  ))}
                  {status === 'blocked' && (
                    <div className="panel !border-danger/60 p-3 text-danger text-sm font-bold block-shake">
                      ⛔ SAFETY GATE ENGAGED — reviewing correction before approval…
                    </div>
                  )}

                  {/* Honest results */}
                  {result && (
                    <div className="panel p-4 mt-3 space-y-1 text-[12px] font-mono">
                      <div className="text-teal font-bold text-sm mb-1">✓ Incident resolved autonomously</div>
                      {result.workOrderId && <div>Work order: <span className="text-offwhite">{result.workOrderId}</span> (real, via MCP)</div>}
                      <div>Safety catches: <span className={result.catches.length ? 'text-danger' : 'text-offwhite'}>{result.catches.length ? result.catches.join(', ') : 'none needed — draft was clean'}</span></div>
                      <div>Resolved in: <span className="text-offwhite">{result.seconds}s</span></div>
                      <div>Memory write-back: <span className="text-offwhite">{result.memoryWritten ? (result.memoryPointId ? `point ${result.memoryPointId.slice(0, 8)}…` : 'completed') : 'not confirmed in this view'}</span></div>
                      <div className="text-muted/80 pt-2 border-t border-dim/50 mt-2">NEXT (roadmap, not built): parts procurement via the same MCP layer.</div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
