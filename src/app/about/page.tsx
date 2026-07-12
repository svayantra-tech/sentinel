// ─────────────────────────────────────────────────────────────────────────────
// Landing page — the product front door (the deck carries the full pitch).
// Lean + animated + interactive: hero, the animated orchestration diagram,
// three problem panels (honest data line), Ask Sentinel (REAL LLM), numbers.
// Honest by construction: synthesized corpus, deterministic local safety gate
// with Enkrypt in parallel — never "real factory data".
// ─────────────────────────────────────────────────────────────────────────────
import type { Metadata } from 'next';
import FlowDiagram from '@/components/FlowDiagram';
import AskSentinel from '@/components/AskSentinel';
import AgentCTA from '@/components/AgentCTA';

export const metadata: Metadata = {
  title: 'Sentinel — When a machine fails at 3 AM',
  description:
    'Sentinel closes the maintenance loop autonomously: retrieval-grounded runbooks, a deterministic safety gate, real human-in-the-loop, and a memory flywheel. Mastra · Qdrant · Enkrypt · 100% TypeScript.',
};

const PROBLEMS = [
  {
    icon: '⏱', title: 'Hours lost to diagnosis',
    body: 'At 3 AM the answer lives in a 400-page OEM PDF and a CMMS full of closed tickets nobody re-reads. Sentinel retrieves the 3 most similar past failures and the exact manual section in seconds.',
  },
  {
    icon: '🧓', title: 'Tribal knowledge is retiring',
    body: 'The engineer who fixed this exact fault in 2019 left last spring. Every resolution Sentinel closes is written back to memory — institutional knowledge that compounds instead of walking out the door.',
  },
  {
    icon: '🩹', title: 'One wrong spec injures a worker',
    body: 'A hallucinated torque value or a skipped lockout step is a safety incident, not a typo. Sentinel cross-checks every number and every step against OEM ground truth — deterministically — before a human ever sees it.',
  },
];

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section className="text-center pt-6 pb-12">
        <div className="inline-flex items-center gap-2 chip border-teal/50 text-teal mb-6">
          <span className="h-2 w-2 rounded-full bg-teal led" /> autonomous factory SRE
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold leading-tight text-offwhite">
          When a machine fails at 3 AM, an engineer loses hours —<br className="hidden sm:block" />
          <span className="text-danger">and one wrong torque spec can injure a worker.</span>
        </h1>
        <p className="mx-auto max-w-2xl mt-6 text-lg text-muted leading-relaxed">
          <span className="text-teal font-semibold">Sentinel closes the loop autonomously</span> — from fault
          to corrected runbook to human sign-off to institutional memory.
        </p>
        <p className="mt-4 text-[12px] font-mono text-muted/80">Mastra · Qdrant · Enkrypt · 100% TypeScript</p>
        <div className="flex items-center justify-center gap-3 mt-8">
          <a href="/" className="btn btn-teal">Open the live console →</a>
          <AgentCTA />
        </div>
      </section>

      {/* ── THE CENTERPIECE: animated orchestration ──────────────────── */}
      <section className="mb-14">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xl font-bold text-offwhite">The autonomous loop</h2>
          <span className="text-[11px] font-mono text-muted">hover / tap a node</span>
        </div>
        <FlowDiagram />
      </section>

      {/* ── THE PROBLEM ──────────────────────────────────────────────── */}
      <section className="mb-14">
        <div className="grid sm:grid-cols-3 gap-4">
          {PROBLEMS.map((p) => (
            <div key={p.title} className="panel p-5">
              <div className="text-2xl mb-2">{p.icon}</div>
              <h3 className="font-bold text-offwhite mb-2">{p.title}</h3>
              <p className="text-[13px] text-muted leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] font-mono text-muted/70 mt-3 text-center">
          Demo data: 15-year synthesized corpus — 2,800+ incidents modeled on real-world failure modes + public
          datasets (NASA C-MAPSS, AI4I). Not real factory data.
        </p>
      </section>

      {/* ── ASK SENTINEL (real LLM) ──────────────────────────────────── */}
      <section className="mb-14 max-w-3xl mx-auto">
        <AskSentinel />
      </section>

      {/* ── NUMBERS + CLOSE ──────────────────────────────────────────── */}
      <section className="text-center pb-8">
        <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
          {[
            ['2,800+', 'synthesized incidents'],
            ['3', 'mandatory integrations, all load-bearing'],
            ['real', 'suspend/resume human-in-the-loop'],
            ['100%', 'TypeScript'],
          ].map(([n, l]) => (
            <div key={l} className="panel px-5 py-3">
              <div className="text-teal font-bold text-xl">{n}</div>
              <div className="text-[11px] font-mono text-muted uppercase">{l}</div>
            </div>
          ))}
        </div>
        <a href="/" className="btn btn-teal">Open the live console →</a>
      </section>
    </main>
  );
}
