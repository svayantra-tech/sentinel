# Sentinel — 3–5 Minute Demo Video Script

**Setup before recording:** `DEMO_MODE=scripted` (reproducible), server running, browser at localhost:3000 logged out, second browser window on /technician, third on /observability. Clean state: restart the dev server (memory backend reseeds itself).

---

### BEAT 1 — The problem (0:00–0:25)
Face/slide: *"Unplanned downtime costs manufacturers fifty billion dollars a year. The fix for any machine failure usually exists — in a retired engineer's memory, page 212 of an OEM manual, or a closed ticket nobody re-reads. And you can't just point an LLM at a factory, because a hallucinated torque value isn't a wrong answer — it's an injury. Meet Sentinel: the factory SRE."*

### BEAT 2 — Login & the auth story (0:25–0:40)
Login as **Priya (L2)**. One line: *"JWT with an authorisation level — and watch what that level does later: it filters what the agent is even allowed to retrieve."*

### BEAT 3 — Inject the fault (0:40–1:10)
Click **⚡ Inject fault** on PUMP-7 (VIB-201 vibration). Narrate the stepper lighting up: *"Work order auto-created in the CMMS over a real MCP server. Then Qdrant: three collections — incident history, OEM manuals, vetted runbooks — searched semantically WITH hard payload filters. Equipment type must match; the LOTO isolation procedure is force-included every time; and runbooks above Priya's skill level never leave the database."* Point at the % match chips and the filter line.

### BEAT 4 — Scorers (1:10–1:30)
Point at the scorecard: *"Before any human sees this runbook, Mastra scorers gate it — relevance, safety, completeness. And deliberately: these scorers are deterministic. In a plant, safety is never graded by vibes."*

### BEAT 5 — ⛔ THE MONEY MOMENT (1:30–2:20)
The red panel. Slow down. *"Here's why Sentinel exists. The drafted runbook says: torque the bearing cap to 80 newton-metres. The Enkrypt safety gate cross-checks every number against the OEM manual we retrieved — and the manual says 45. Eighty would distort the bearing race and fail again within 600 hours. BLOCKED — with the manual excerpt as evidence — and corrected to 45 before a human ever sees it."* Then: *"We inject this fault deliberately in demo mode — chaos engineering for safety gates. In live mode the same arithmetic catches real hallucinations."*

### BEAT 6 — Suspend → human approval (2:20–2:50)
Amber banner: *"The Mastra workflow is now genuinely suspended — suspend/resume, persisted state. The agent cannot proceed. Nothing physical happens without a human."* Switch to the phone-framed **Technician view**, show the blocked notice + corrected steps, tap **Approve & resume**.

### BEAT 7 — Post-mortem & THE FLYWHEEL (2:50–3:40)
Back on Operations: EXECUTING → post-mortem (point out: blameless, bias-gated) → *"and the incident is upserted into Qdrant."* Now the kill shot: **inject the same fault again.** Point at the retrieval panel: *"Top match: the incident we resolved ninety seconds ago — with the verified 45 Nm fix. Every failure makes this plant permanently smarter. That's the flywheel, live."*

### BEAT 8 — Observability + close (3:40–4:30)
Observability tab: *"And the Round-1 feedback, answered: full OpenTelemetry — every span, token counts, latency, prompt hashes for drift detection, correlation IDs across every subsystem, the blocked event in red — exportable to Jaeger via OTLP."* Close: *"Mastra orchestration with real suspend/resume. Qdrant memory with filtered retrieval and write-back. Enkrypt safety that arithmetic backs up. All TypeScript. Sentinel — the factory SRE."*

---

**Timing target 4:15. If over: compress Beat 2 into Beat 3's narration.**
**Backup plan:** everything above runs with zero network (memory store + scripted mode). If wifi dies on stage, nothing changes.
