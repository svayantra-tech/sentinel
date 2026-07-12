'use client';
// "Ask Sentinel" — landing-page chat wired to the REAL LLM via /api/ask.
// Real model responses only; graceful message when the model is unreachable.
import { useState } from 'react';

const SUGGESTED = [
  'What does Sentinel do?',
  'How does the safety gate work?',
  'How would this connect to a real factory?',
];

interface Msg { role: 'you' | 'sentinel'; text: string; meta?: string }

export default function AskSentinel() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setQ('');
    setBusy(true);
    setMsgs((m) => [...m, { role: 'you', text: question }]);
    try {
      const res = await fetch('/api/ask', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'unavailable');
      setMsgs((m) => [...m, { role: 'sentinel', text: json.answer, meta: `${json.provider} · ${json.model}` }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'sentinel', text: `⚠ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="h-2.5 w-2.5 rounded-full bg-teal led" />
        <h3 className="font-bold text-offwhite">Ask Sentinel</h3>
        <span className="chip border-dim text-muted ml-auto">real LLM — live inference</span>
      </div>

      <div className="space-y-3 mb-4 max-h-72 overflow-y-auto">
        {msgs.length === 0 && (
          <p className="text-sm text-muted">Ask anything about how Sentinel works — answered live by the model behind it.</p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`text-sm leading-relaxed ${m.role === 'you' ? 'text-right' : ''}`}>
            <div className={`inline-block px-3 py-2 rounded-lg max-w-[85%] text-left ${m.role === 'you' ? 'bg-dim/50 text-offwhite' : 'bg-navy border border-dim/60 text-offwhite/90'}`}>
              {m.text}
              {m.meta && <div className="text-[10px] font-mono text-muted/70 mt-1">{m.meta}</div>}
            </div>
          </div>
        ))}
        {busy && <p className="text-[12px] font-mono text-muted animate-pulse">Sentinel is thinking…</p>}
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {SUGGESTED.map((s) => (
          <button key={s} onClick={() => ask(s)} disabled={busy} className="chip border-teal/40 text-teal hover:bg-teal/10">
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2">
        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a question…"
          maxLength={400}
          className="flex-1 bg-ink border border-dim rounded-lg px-3 py-2 text-sm"
        />
        <button type="submit" disabled={busy || !q.trim()} className="btn btn-teal">Ask</button>
      </form>
    </div>
  );
}
