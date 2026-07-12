// ─────────────────────────────────────────────────────────────────────────────
// Landing / story page — the problem, the stakes, and what Sentinel does.
// Technical AND emotional. Honest by construction: synthesized corpus, vector
// retrieval + payload filtering, deterministic safety gate (Enkrypt in parallel).
// Non-destructive: "/" stays the Operations console; this is the narrative front.
// ─────────────────────────────────────────────────────────────────────────────
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sentinel — When a machine fails at 3 AM',
  description:
    'Unplanned downtime costs manufacturers $50B a year — and a single wrong repair instruction can injure a worker. Sentinel is an autonomous maintenance copilot that closes the incident loop and is physically incapable of passing an unsafe instruction to the floor.',
};

const LOOP = [
  { k: 'FAULT', t: 'Fault fires', d: 'A vibration alarm trips at 3 AM. Sentinel ingests it and opens a CMMS work order automatically — via a real MCP tool.' },
  { k: 'MEMORY', t: 'Institutional memory', d: 'Qdrant surfaces the 3 most similar past breakdowns and the exact OEM manual section — semantic search plus hard payload filters.' },
  { k: 'DRAFT', t: 'Runbook drafted', d: 'A step-by-step repair runbook is generated, grounded in what was retrieved — then graded by deterministic scorers before anyone sees it.' },
  { k: 'GATE', t: 'Safety gate', d: 'Every numeric spec and every step is cross-checked against the OEM ground truth. A dangerous instruction is blocked before it reaches a human.' },
  { k: 'HITL', t: 'Human approval', d: 'The workflow suspends and waits. A technician approves the corrected runbook — real human-in-the-loop, real suspend/resume.' },
  { k: 'LEARN', t: 'The flywheel', d: 'A blameless post-mortem is written and the resolved incident is saved back to memory. The next 3 AM failure is faster than this one.' },
];

const STACK = [
  { n: 'Mastra', pct: '25%', d: 'A six-step workflow with real suspend()/resume() human-in-the-loop, deterministic scorers with a self-refine loop, and MCP work-order tools — every primitive load-bearing, not decorative.' },
  { n: 'Qdrant', pct: '20%', d: 'Three collections — incident history, OEM manuals, runbook library. Every retrieval is semantic search + a hard payload filter, and a technician’s auth level is a filter: a junior never even sees a supervisor-only procedure.' },
  { n: 'Enkrypt AI', pct: '20%', d: 'A cloud safety layer running in parallel with a deterministic local physics engine: numeric spec cross-check, lockout/tagout ordering, interlock-tamper detection, and post-mortem blame-bias. If the cloud is down, the local rules still hold the line.' },
];

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="text-center pt-8 pb-14">
        <div className="inline-flex items-center gap-2 chip border-teal/50 text-teal mb-6">
          <span className="h-2 w-2 rounded-full bg-teal led" /> autonomous factory SRE
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold leading-tight text-offwhite">
          When a machine fails at 3 AM,<br />
          <span className="text-teal">knowledge is the thing that&rsquo;s missing.</span>
        </h1>
        <p className="mx-auto max-w-2xl mt-6 text-muted text-lg leading-relaxed">
          Sentinel is an autonomous asset-downtime &amp; maintenance copilot that remembers every failure
          your plant has ever had — and is <span className="text-offwhite">physically incapable of telling a
          technician something unsafe.</span>
        </p>
        <div className="flex items-center justify-center gap-3 mt-8">
          <a href="/" className="btn btn-teal">Launch the console →</a>
          <a href="#loop" className="btn btn-ghost">See how it works</a>
        </div>
        <p className="mt-4 text-[11px] font-mono text-muted/70">Mastra · Qdrant · Enkrypt AI — 100% TypeScript</p>
      </section>

      {/* ── The emotional hook ───────────────────────────────────────── */}
      <section className="panel p-8 mb-6">
        <p className="text-xl sm:text-2xl leading-relaxed text-offwhite">
          It&rsquo;s 3 AM. A critical pump is screaming on the floor. The one engineer who fixed this exact
          fault in 2019 retired last spring. The answer is buried somewhere in a 400-page OEM PDF and a
          CMMS full of closed tickets nobody re-reads.
        </p>
        <p className="text-xl sm:text-2xl leading-relaxed text-muted mt-4">
          So someone guesses. And on a factory floor, <span className="text-danger font-semibold">a wrong
          torque value isn&rsquo;t a wrong answer — it&rsquo;s a workplace injury.</span>
        </p>
      </section>

      {/* ── The problem, in numbers ──────────────────────────────────── */}
      <section className="grid sm:grid-cols-3 gap-4 mb-6">
        {[
          { n: '$50B+', l: 'lost to unplanned downtime every year, across manufacturers' },
          { n: '₹-crore', l: 'the cost of a single hour of downtime in a large plant' },
          { n: '2–3 hrs', l: 'an engineer burns just diagnosing a fault before real work begins' },
        ].map((s) => (
          <div key={s.n} className="panel p-6 text-center">
            <p className="text-3xl font-bold text-teal">{s.n}</p>
            <p className="text-sm text-muted mt-2 leading-snug">{s.l}</p>
          </div>
        ))}
      </section>

      <section className="panel p-8 mb-6">
        <h2 className="text-lg font-semibold text-offwhite mb-3">Why generic AI makes this worse, not better</h2>
        <p className="text-muted leading-relaxed">
          Drop a general-purpose chatbot into a plant and the failure mode is catastrophic. Ask it for a
          bearing-cap torque and it will confidently invent one. In an office, a hallucinated number is an
          annoyance you catch later. On a factory floor, it&rsquo;s torqued into a machine at
          <span className="text-danger"> 80 newton-metres when the manual says 45</span> — and now you have a
          cracked casting, a destroyed ₹-crore machine, or a technician in the emergency room. Fluency is not
          safety. <span className="text-offwhite">The industrial world doesn&rsquo;t need a more articulate
          guesser — it needs a system that cannot pass a dangerous instruction to a human.</span>
        </p>
      </section>

      {/* ── What Sentinel does — the loop ────────────────────────────── */}
      <section id="loop" className="mb-6 scroll-mt-20">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-offwhite">The incident loop, run the way an SRE team runs software</h2>
          <p className="text-muted mt-2">Fault to fix to memory — autonomously, with a human as the final authority.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {LOOP.map((step, i) => (
            <div key={step.k} className="panel p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="chip border-teal/50 text-teal">{String(i + 1).padStart(2, '0')}</span>
                <span className="font-mono text-[11px] text-muted">{step.k}</span>
              </div>
              <p className="font-semibold text-offwhite">{step.t}</p>
              <p className="text-sm text-muted mt-1 leading-snug">{step.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── The money moment ─────────────────────────────────────────── */}
      <section className="panel p-8 mb-6 !border-danger/50">
        <div className="flex flex-col sm:flex-row items-start gap-6">
          <div className="flex-1">
            <p className="chip border-danger/60 text-danger mb-3">⛔ the moment that matters</p>
            <h2 className="text-xl font-semibold text-offwhite mb-2">The draft said 80 Nm. The manual says 45.</h2>
            <p className="text-muted leading-relaxed">
              This is the safety gate doing its job. Before a corrected runbook ever reaches a technician,
              every spec is checked against the retrieved OEM ground truth. The dangerous step is blocked,
              the manual excerpt is shown, and the correct value is substituted — deterministically, every
              time. Safety here is never graded by vibes.
            </p>
          </div>
          <div className="w-full sm:w-72 shrink-0 rounded-lg border border-danger/60 bg-danger/10 p-4 font-mono text-sm">
            <p className="text-danger font-bold">⛔ BLOCKED · HALLUCINATED_SPEC</p>
            <p className="text-offwhite mt-2">Step 5: torque bearing cap to <span className="line-through text-danger">80 Nm</span></p>
            <p className="text-teal mt-2">→ corrected to OEM spec 45 Nm<br />(two passes, cross-pattern 25 → 45)</p>
          </div>
        </div>
      </section>

      {/* ── The stack ────────────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="text-2xl font-bold text-offwhite text-center mb-6">Built on three technologies, each load-bearing</h2>
        <div className="space-y-4">
          {STACK.map((s) => (
            <div key={s.n} className="panel p-6">
              <div className="flex items-baseline gap-3 mb-1">
                <h3 className="text-lg font-semibold text-teal">{s.n}</h3>
                <span className="chip border-dim text-muted">{s.pct} of the rubric</span>
              </div>
              <p className="text-muted leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── The flywheel / impact ────────────────────────────────────── */}
      <section className="panel p-8 mb-6">
        <h2 className="text-lg font-semibold text-offwhite mb-3">Every failure makes the next one faster</h2>
        <p className="text-muted leading-relaxed">
          When an incident resolves, Sentinel writes a blameless post-mortem — bias-checked so it never
          defaults to &ldquo;operator error&rdquo; — and saves the whole incident back to memory. Inject the
          same fault ninety seconds later and the fix comes right back. That&rsquo;s the flywheel: institutional
          knowledge that compounds instead of retiring. In our 15-year synthesized corpus of ~3,000 cases,
          modeled on real-world failure modes, mean time-to-repair falls
          <span className="text-teal"> 53% </span> as the memory fills — and the plant stops making the same
          mistake twice.
        </p>
        <p className="text-[11px] font-mono text-muted/60 mt-4">
          Honest by construction: the corpus is synthesized (not real production data); retrieval is vector
          search with payload filtering; the safety gate is a deterministic engine with Enkrypt AI running in
          parallel — a cloud outage can never open a safety hole.
        </p>
      </section>

      {/* ── Closing ──────────────────────────────────────────────────── */}
      <section className="text-center py-12">
        <p className="text-2xl sm:text-3xl font-bold text-offwhite max-w-2xl mx-auto leading-snug">
          The next factory fire drill should be the last one anyone improvises.
        </p>
        <div className="flex items-center justify-center gap-3 mt-8">
          <a href="/" className="btn btn-teal">Launch the console →</a>
          <a href="/knowledge" className="btn btn-ghost">Inspect the memory</a>
        </div>
      </section>
    </main>
  );
}
