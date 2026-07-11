'use client';
// ─────────────────────────────────────────────────────────────────────────────
// Live pipeline view — a truthful, dependency-free readout of the REAL event
// stream (GET /api/stream, SSE). Every chip, pulse and feed line below is a
// real event published at an actual step boundary; nothing is scripted or
// invented here. EventSource authenticates via the httpOnly session cookie set
// at login and auto-reconnects with Last-Event-ID replay.
// This is the minimal live surface — deliberately no chart/3D libraries.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react';
import { useSession } from '@/lib/client';
import type { LiveEvent } from '@/lib/event-bus';

const STAGES = [
  'FAULT_INGESTED', 'CONTEXT_RETRIEVED', 'RUNBOOK_DRAFTED', 'SCORED',
  'SAFETY_CHECKED', 'SUSPENDED', 'TECHNICIAN_APPROVED', 'EXECUTING',
  'POST_MORTEM', 'MEMORY_WRITTEN', 'DONE',
] as const;

const KIND_COLOR: Record<string, string> = {
  workflow: 'text-offwhite border-dim',
  llm: 'text-teal border-teal/50',
  qdrant: 'text-[#7aa2ff] border-[#7aa2ff]/50',
  enkrypt: 'text-amber border-amber/50',
  mcp: 'text-[#c084fc] border-[#c084fc]/50',
  scorer: 'text-[#f472b6] border-[#f472b6]/50',
};

export default function LivePage() {
  const { user, ready } = useSession();
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const es = new EventSource('/api/stream'); // session cookie carries auth
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    const onFrame = (m: MessageEvent) => {
      const e = JSON.parse(m.data) as LiveEvent;
      setEvents((prev) => [...prev.slice(-199), e]);
    };
    es.addEventListener('stage', onFrame);
    es.addEventListener('trace', onFrame);
    return () => es.close();
  }, [user]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [events]);

  if (!ready) return null;
  if (!user) return (
    <main className="mx-auto max-w-md px-4 pt-20 text-center text-muted">
      <p>Sign in on the <a href="/" className="text-teal underline">Operations</a> page first.</p>
    </main>
  );

  // Latest run visible in the stream drives the stage strip — all real state.
  const latestRunId = [...events].reverse().find((e) => e.type === 'stage')?.runId;
  const runStages = events.filter((e) => e.type === 'stage' && e.runId === latestRunId);
  const latest = runStages[runStages.length - 1];
  const reached = new Set(runStages.map((e) => e.stage));
  const blocked = latest?.payload?.safety?.violations.filter((v) => v.severity === 'block') ?? [];
  // Real-signal LIVE detection: an llm trace event for this run means real inference fired.
  const llmFired = events.some((e) => e.type === 'trace' && e.kind === 'llm' && e.runId === latestRunId);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <div className="flex items-center gap-3 mb-1 flex-wrap">
        <h1 className="text-2xl font-bold">Live Pipeline</h1>
        <span className={`chip ${connected ? 'border-teal/60 text-teal' : 'border-amber/60 text-amber'}`}>
          {connected ? 'stream connected' : 'stream reconnecting…'}
        </span>
        {latest && (
          <span className={`chip ${llmFired ? 'border-teal/60 text-teal' : 'border-dim text-muted'}`}>
            drafter: {llmFired ? 'LIVE LLM firing' : 'scripted / no LLM call yet'}
          </span>
        )}
      </div>
      <p className="text-muted text-sm mb-5">
        Every chip and feed line is a real event from <span className="font-mono text-teal">/api/stream</span> —
        emitted at actual step boundaries. Inject a fault on <a href="/" className="text-teal underline">Operations</a> and watch it run.
      </p>

      {/* Stage strip — pulses on the real active stage, locks in reached stages */}
      <div className="panel p-4 mb-4">
        <p className="text-[10px] font-mono text-muted uppercase mb-3">
          workflow run {latestRunId ? `· ${latestRunId.slice(0, 8)}` : '· waiting for a run'}
        </p>
        <div className="flex flex-wrap gap-2">
          {STAGES.map((s) => {
            const isActive = latest?.stage === s && s !== 'DONE';
            const isReached = reached.has(s);
            const isBlockStage = s === 'SAFETY_CHECKED' && blocked.length > 0;
            return (
              <span
                key={s}
                className={`chip transition-all ${
                  isBlockStage ? 'border-red-500 text-red-400 bg-red-500/10'
                  : isActive ? 'border-teal text-teal animate-pulse'
                  : isReached ? 'border-teal/40 text-offwhite'
                  : 'border-dim text-muted/50'
                }`}
              >
                {s === 'SUSPENDED' && isActive ? '⏸ AWAITING TECHNICIAN' : s.replaceAll('_', ' ')}
              </span>
            );
          })}
        </div>
        {blocked.length > 0 && (
          <div className="mt-3 border border-red-500/50 bg-red-500/10 rounded-lg p-3">
            {blocked.map((v, i) => (
              <p key={i} className="text-sm text-red-400">
                ⛔ {v.type} <span className="text-muted">(source={v.source}{latest?.payload?.safety?.cloudUsed ? ' · Enkrypt cloud ran in parallel' : ''})</span> — {v.detail}
                {v.correction && <span className="block text-teal mt-1">✓ corrected: {v.correction}</span>}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Live event feed — raw, truthful, newest at the bottom */}
      <div className="panel p-4">
        <p className="text-[10px] font-mono text-muted uppercase mb-2">event feed · {events.length} events</p>
        <div ref={feedRef} className="max-h-80 overflow-y-auto font-mono text-[11px] space-y-1">
          {events.length === 0 && <p className="text-muted">Waiting for events…</p>}
          {events.map((e) => (
            <div key={e.seq} className="flex gap-2 items-baseline">
              <span className="text-muted/60 shrink-0">{e.at.slice(11, 19)}</span>
              {e.type === 'stage' ? (
                <span className="text-offwhite">
                  <span className="text-teal">STAGE</span> {e.stage}
                  {e.note && <span className="text-muted"> — {e.note}</span>}
                </span>
              ) : (
                <span className={(KIND_COLOR[e.kind ?? ''] ?? 'text-muted').split(' ')[0]}>
                  [{e.kind}] {e.step} · {e.status} · {e.latencyMs}ms
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
