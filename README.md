<div align="center">

# ⚡ SENTINEL — The Factory SRE

**An autonomous asset-downtime & maintenance copilot that remembers every failure your plant has ever had — and is physically incapable of telling a technician something unsafe.**

Mastra workflows · Qdrant memory · Enkrypt AI safety — **100% TypeScript**

*HiDevs × Mastra Hackathon 2026 · Open Innovation Track · Round 2*

</div>

---

## The problem

Unplanned downtime costs manufacturers **$50B+ every year**. When a machine goes down at 3 AM, the knowledge needed to fix it fast lives in three places that don't talk to each other: a retired engineer's head, a 400-page OEM PDF, and a CMMS full of closed tickets nobody re-reads. Generic LLMs make this *worse* — a hallucinated torque value isn't a wrong answer, it's a **workplace injury**.

## The solution

Sentinel runs the full incident loop the way an SRE team runs software incidents:

```
fault → work order (MCP) → institutional memory (Qdrant) → runbook draft (LLM)
     → quality scorers (Mastra) → safety gate (Enkrypt) → human approval ⏸ (suspend/resume)
     → execution → blameless post-mortem → memory write-back  ⟲ the flywheel
```

Every resolved incident makes the next one faster. Every instruction is cross-checked against OEM ground truth **before** a human sees it.

## 60-second quickstart

```bash
npm install
npm run dev          # → http://localhost:3000  (zero infra needed)
```

That's it. With no env config, Sentinel runs on its built-in in-memory vector store (auto-seeded, identical filter semantics to Qdrant) and deterministic demo mode. Login: pick any user · password `sentinel-demo`.

**Full-fat mode** (persistent Qdrant + Jaeger tracing + live LLM):

```bash
cp .env.example .env.local     # add LLM keys (Featherless/Groq), set QDRANT_URL
docker compose up -d           # Qdrant :6333 · Jaeger UI :16686
npm run seed                   # ~2,700 incidents · 20 OEM chunks · 12 vetted runbooks
npm run dev
```

**Qdrant Cloud (no docker):** create a free cluster at [cloud.qdrant.io](https://cloud.qdrant.io), put its URL + API key in `.env.local` as `QDRANT_URL` / `QDRANT_API_KEY`, then run `npm run seed` **once** to push the corpus to the cloud. Seeding is idempotent (deterministic point IDs) — re-running never doubles the count; `npm run seed -- --reset` wipes and repopulates. Confirm it's live with `npm run qdrant:verify`, or open the `/knowledge` page in the app.

**Verify everything yourself:**

```bash
npm run typecheck    # strict TS, zero errors
npm run smoke        # 12 assertions: retrieval filters, safety catches, scorers, flywheel
npm run history:check    # 15-year corpus scale + the MTTR flywheel, proven
npm run qdrant:verify    # live Qdrant: collection counts, dims, sample filtered search
npx tsx scripts/e2e.ts   # REAL Mastra run: start → SUSPENDED → resume → DONE
npm run mcp:cmms     # standalone MCP server (inspect: npx @modelcontextprotocol/inspector npx tsx src/mcp/cmms-server.ts)
```

## The 3-minute demo (see `docs/DEMO_SCRIPT.md`)

1. **Inject fault** on PUMP-7 (vibration alarm) → work order auto-created via MCP.
2. **Qdrant panel** shows 3 similar past incidents (semantic + `equipment_type` hard filter) + OEM chunks + LOTO section force-included.
3. Runbook drafts; **Mastra scorers** gate it (relevance/safety/completeness, deterministic).
4. **⛔ The money moment:** the draft says *torque bearing cap to 80 Nm*. The Enkrypt gate cross-checks the OEM manual — **spec is 45 Nm** — blocks the step, shows the manual excerpt, substitutes the correct value.
5. Workflow **suspends** (real Mastra `suspend()`); technician approves on the mobile view → `resume()`.
6. Blameless post-mortem (bias-gated) → **incident upserted to Qdrant**.
7. **Inject the same fault again** — retrieval now surfaces the fix from 90 seconds ago. *The flywheel, live.*
8. **Observability tab**: every span, token counts, prompt hashes, the ⛔ event in red.

## Architecture

```
┌────────────────────────── Next.js 14 (TypeScript) ──────────────────────────┐
│  Operations UI      Technician UI (HITL)      Observability UI              │
│  ────────────────────────── /api (JWT · rate-limit · Zod) ────────────────  │
│                                                                             │
│   MASTRA WORKFLOW  sentinel-maintenance (createWorkflow → 6 createSteps)    │
│   ingest → retrieve → draft+score(↻refine) → safety-gate → ⏸approval → close│
│        │            │                │                │                     │
│        ▼            ▼                ▼                ▼                     │
│   MCP CMMS      QDRANT ×3        LLM CHAIN        ENKRYPT + local physics   │
│   (real MCP     incident_history Featherless      Mode1 spec cross-check    │
│    server,      oem_manuals      →Groq fallback,  Mode2 LOTO/interlock/auth │
│    stdio)       runbook_library  key rotation     Mode3 post-mortem bias    │
│                 (filters: equipment_type, skill_level ≤ auth)               │
│                                                                             │
│   OpenTelemetry: every box above emits spans → TraceStore (in-app panel)    │
│                                             └→ OTLP → Jaeger (docker)       │
│   State: Mastra LibSQLStore (file → Turso in prod) · 12-Factor env config   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## How this maps to the judging criteria

| Criterion | Where to look |
|---|---|
| **Mastra (25%)** | `src/mastra/workflow.ts` — 6-step `createWorkflow` chain, **real `suspend()`/`resume()`** HITL gate (`scripts/e2e.ts` proves it), deterministic scorer stage with self-refine loop, LibSQL-persisted run state |
| **Qdrant (20%)** | `src/lib/memory.ts` — 3 collections with payload schemas, every search = **semantic + hard filter** (`equipment_type`, `skill_level_required ≤ authLevel`), LOTO force-include, write-back flywheel (demoed live, twice) |
| **Enkrypt (20%)** | `src/lib/safety.ts` — cloud detectors **unioned with** a deterministic local physics engine: numeric spec cross-check vs OEM, LOTO ordering, interlock tampering, auth ceilings, post-mortem bias. Cloud outage can never open a safety hole |
| **Technical depth (15%)** | OTel + GenAI semantic attrs + prompt-hash drift tracking; JWT with auth-level claims that *flow into vector filters*; key-rotating LLM provider chain; real MCP server; 12 smoke + 4 e2e assertions |
| **Innovation (10%)** | The memory flywheel; **deterministic safety scoring** ("safety is never graded by vibes"); chaos-engineering fault injection for reproducible safety demos; auth-as-retrieval-filter |
| **Presentation (10%)** | Control-room UI with the ⛔ BLOCKED moment front and centre; `docs/DEMO_SCRIPT.md` beat sheet |

## Documentation

| Doc | Contents |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | IEEE 830-style SRS: FR-01…FR-14, NFR-01…NFR-08, acceptance criteria, **requirement→code traceability matrix** (grep `FR-07` in the codebase — every requirement ID is annotated at its implementation site) |
| [`docs/PROMPTS.md`](docs/PROMPTS.md) | CRISPE prompt engineering: all templates, few-shot rationale, hash-based drift tracking |
| [`docs/SECURITY.md`](docs/SECURITY.md) | JWT/authz model, rate limiting, Zod validation, encryption standards, production hardening path |
| [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) | The tracing architecture, GenAI semantic conventions, Jaeger setup, what each span kind means |
| [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) | 3–5 min video script, beat by beat, incl. the fault-injection framing |

## Configuration (12-Factor — every knob is env)

See [`.env.example`](.env.example). Highlights: `LLM_API_KEYS` (comma-separated, auto-rotated on 429/5xx), `LLM_FALLBACK_*` (second provider), `QDRANT_URL` (empty = in-memory), `DEMO_MODE` (`live` = real inference · `scripted` = deterministic fault-injection for reproducible demos — the injection is a **documented chaos-engineering seed**, see `src/mastra/logic.ts`), `OTEL_EXPORTER_OTLP_ENDPOINT`, `MASTRA_DB_URL`.

## Deployment (live demo URL)

**Vercel + free tiers:** push to GitHub → import in Vercel → set env: `QDRANT_URL`/`QDRANT_API_KEY` (Qdrant Cloud free 1 GB), `MASTRA_DB_URL`/auth token (Turso free — required so suspend/resume survives serverless invocations), `JWT_SECRET`, LLM keys, `DEMO_MODE=scripted` for the judged demo. Run `npm run seed` once locally pointing at the cloud Qdrant.
**Railway/Render (simpler):** one persistent Node service — file-based LibSQL works as-is; add a Qdrant service from template.

## Honest engineering notes

- **Framework isolation:** every `@mastra/*` import lives in exactly two files (`src/mastra/workflow.ts`, `src/mastra/index.ts`). Business logic (`logic.ts`, `safety.ts`, `memory.ts`, `scorers.ts`) is pure TypeScript — testable without an agent runtime, immune to framework churn. Built and verified against **Mastra 1.x** (`@mastra/core@^1.49`).
- **Graceful degradation everywhere (NFR-04):** LLM down → deterministic drafter. Enkrypt cloud down → local physics engine already covers the dangerous checks. Qdrant absent → in-memory store with identical filter semantics. The demo cannot dead-end.
- **The scripted 80 Nm injection is not a trick** — it's labelled in code, framed as chaos engineering, and in `live` mode the same gate catches *real* hallucinations by the same arithmetic.

---

*Sentinel — because the next factory fire drill should be the last one anyone improvises.*
