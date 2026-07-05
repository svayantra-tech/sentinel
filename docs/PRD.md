# Sentinel — Software Requirements Specification (SRS)

**IEEE 830-style · Round 2 build edition** — this document supersedes the Round-1 PRD by adding formal requirement IDs, measurable acceptance criteria, and a requirement→implementation traceability matrix. Every FR/NFR ID below is also annotated **in the source code** at its implementation site (`grep -rn "FR-08" src/`).

---

## 1. Purpose & scope

Sentinel is an autonomous asset-downtime and maintenance copilot for discrete/process manufacturing plants. It ingests machine faults, retrieves institutional memory, drafts safety-gated repair runbooks, enforces human approval before any physical action, and writes every resolution back into memory. Mandatory stack: **Mastra** (orchestration), **Qdrant** (vector memory), **Enkrypt AI** (safety), TypeScript only.

## 2. Definitions

| Term | Meaning |
|---|---|
| LOTO | Lockout/Tagout — energy isolation before intrusive work |
| CMMS | Computerized Maintenance Management System (SAP PM, Maximo) |
| HITL | Human-in-the-loop approval gate |
| Runbook | Ordered step list: action + verification (+ PPE) |
| Flywheel | Resolved incidents becoming retrievable memory for future runs |

## 3. Functional requirements

Each requirement lists its acceptance criterion (AC). All ACs are executable: `npm run smoke` + `npx tsx scripts/e2e.ts` + the live HTTP test cover them.

| ID | Requirement | Acceptance criterion |
|---|---|---|
| **FR-01** | Ingest faults (sensor or operator) validated against a strict schema | Invalid payloads rejected 422 with field-level Zod issues; valid → 202 + runId |
| **FR-02** | Auto-create a CMMS work order on ingestion via the MCP tool surface | Work order with priority mapping (critical→P1) exists before retrieval begins |
| **FR-03** | Maintain 3 Qdrant collections with typed payload schemas (`incident_history`, `oem_manuals`, `runbook_library`) | Seed yields 50/8/5 points; payload fields match `src/lib/types.ts` interfaces |
| **FR-04** | Every retrieval = semantic search **plus** hard payload filter on `equipment_type` | 0 cross-equipment leaks across smoke assertions |
| **FR-05** | Retrieval returns top-3 incidents, ≤5 OEM chunks (LOTO section force-included), ≤2 runbooks | Smoke test [2/6] |
| **FR-06** | Draft a structured runbook (3–12 steps, each action+verification) grounded in retrieved context, via CRISPE-templated LLM with deterministic fallback | Zod-valid `DraftRunbook` on every run; `source` recorded (`llm`/`scripted`) |
| **FR-07** | Score every draft with deterministic relevance/safety/completeness scorers; below-threshold drafts get one self-refinement pass | Scorecard visible in UI + traces with `attempt` number; corrected demo runbook scores ≥0.75 on all three |
| **FR-08** | **No physical action without human approval**: workflow suspends via Mastra `suspend()` after the safety gate; only an authenticated approval resumes it | e2e: run reaches `SUSPENDED` and stays; HTTP approve → `DONE`. 409 on double-approval |
| **FR-09** | Safety-gate every runbook: (M1) numeric specs cross-checked against OEM ground truth, (M2) LOTO ordering + interlock tampering + authorisation ceiling | 80→45 Nm catch with OEM citation; LOTO_BYPASS and AUTH_EXCEEDED assertions green; **zero false positives** on the vetted demo runbook |
| **FR-10** | Generate a blameless five-section post-mortem, bias-gated (M3) | "operator error" without sensor evidence → flagged + reframed |
| **FR-11** | Write every resolved incident back to `incident_history` (the flywheel) | Re-retrieval after resolution surfaces the new incident (smoke [6/6]) |
| **FR-12** | Close the CMMS work order with the resolution record via MCP | WO status `COMPLETED` + rootCause/fixApplied/minutes persisted |
| **FR-13** | JWT auth (role + authLevel claims) on every API route; authLevel gates runbook retrieval (`skill_level_required ≤ authLevel`) | 401 unauthenticated; L1 user never retrieves L2 runbooks (smoke [2/6]) |
| **FR-14** | Ship a seeded demo corpus: ≥50 incidents, OEM chunks incl. the torque ground truth, skill-gated runbooks | `npm run seed` output |

## 4. Non-functional requirements

| ID | Requirement | Acceptance criterion |
|---|---|---|
| **NFR-01** | **LLM observability**: OTel spans on every workflow/LLM/Qdrant/Enkrypt/MCP/scorer operation; GenAI semantic attributes (model, token in/out, latency); prompt-hash drift tracking; correlation ID per run; OTLP export + in-app live panel | Observability tab shows ≥10 spans per run incl. the ⛔ blocked event; Jaeger receives spans when endpoint set |
| **NFR-02** | Scorer pass threshold 0.75 on all three axes | Enforced in `runScorers`; smoke [4/6] |
| **NFR-03** | API hardening: token-bucket rate limit 60 req/min (burst 20) per client; Zod validation on every body | 429 with `retry-after` under flood; 422 on malformed input |
| **NFR-04** | Graceful degradation: LLM/Enkrypt/Qdrant outage must never dead-end a run | Deterministic drafter, local safety engine, in-memory store — all exercised by smoke |
| **NFR-05** | Bounded memory: trace ring buffer ≤500 events; embedding cache ≤2000 | Code-enforced |
| **NFR-06** | 12-Factor: all config via env (`.env.example` is exhaustive); backing services swappable by URL | Zero-env boot works; each service swaps by env alone |
| **NFR-07** | Workflow state durability: suspend/resume survives process restart via LibSQL storage (Turso in serverless) | Resume path rehydrates by `runId` when the in-process handle is lost |
| **NFR-08** | Latency: retrieval < 800 ms local; scripted-mode fault→SUSPENDED < 5 s | Observed in live HTTP test |

## 5. State machine (implemented verbatim in `src/mastra/workflow.ts`)

`IDLE → FAULT_INGESTED → CONTEXT_RETRIEVED → RUNBOOK_DRAFTED → SCORED → SAFETY_CHECKED → SUSPENDED ⏸ → TECHNICIAN_APPROVED → EXECUTING → POST_MORTEM → MEMORY_WRITTEN → DONE` (+ `FAILED` from any state; rejection at the gate short-circuits to `DONE` with outcome `rejected`).

## 6. Data model (Qdrant payloads)

Defined as TypeScript interfaces in `src/lib/types.ts` — `IncidentPayload` (12 fields incl. `root_cause`, `fix_applied`, `time_to_resolve_minutes`, `outcome`), `ManualPayload` (7 fields incl. `section_type`: maintenance/safety/torque_specs/lockout_tagout), `RunbookPayload` (7 fields incl. `skill_level_required` 1-3, `safety_rating`). Payload indexes created on all filter keys.

## 7. Traceability matrix (requirement → code → verification)

| ID | Implementation | Verified by |
|---|---|---|
| FR-01 | `src/lib/types.ts` (`FaultInput`), `src/app/api/faults/route.ts` | live HTTP test (202/422) |
| FR-02 | `src/mcp/cmms.ts`, workflow step `ingest-fault` | e2e (`workOrderId` before context) |
| FR-03 | `src/lib/memory.ts` (`COLLECTIONS`, `seedAll`), `src/data/seed-corpus.ts` | smoke [1/6] |
| FR-04/05 | `src/lib/memory.ts` (`retrieveContext`) | smoke [2/6] |
| FR-06 | `src/mastra/logic.ts` (`draftRunbookLogic`), `src/mastra/prompts.ts` | smoke [3/6], e2e |
| FR-07 | `src/mastra/scorers.ts`, workflow step `draft-and-score` | smoke [4/6] |
| FR-08 | workflow step `technician-approval` (suspend/resume), `/api/runs/[id]/approve` | e2e + live HTTP test |
| FR-09 | `src/lib/safety.ts` (`checkRunbook`) | smoke [3/6] (3 catch types + no-false-positive) |
| FR-10 | `src/mastra/logic.ts` (`postMortemLogic`), `src/lib/safety.ts` (`checkPostMortem`) | smoke [5/6] |
| FR-11 | `src/lib/memory.ts` (`writeBackIncident`), workflow step `execute-and-close` | smoke [6/6], e2e |
| FR-12 | `src/mcp/cmms.ts` (`updateWorkOrder`) | e2e |
| FR-13 | `src/lib/auth.ts`, every `/api/*` route | live HTTP test (401), smoke [2/6] |
| FR-14 | `src/data/seed-corpus.ts`, `scripts/seed.ts` | smoke [1/6] |
| NFR-01 | `src/lib/telemetry.ts`, `src/instrumentation.ts`, Mastra `Observability` config | live HTTP test (trace feed) |
| NFR-03 | `src/lib/auth.ts` (`rateLimit`, `parseBody`) | code + flood test |
| NFR-04 | fallback branches in `llm.ts`, `safety.ts`, `memory.ts`, `embeddings.ts` | smoke runs entirely on fallbacks |
| NFR-06 | `.env.example`, `getStore()` selection | zero-env boot |
| NFR-07 | `LibSQLStore` config, `resumeSentinelRun` rehydration | e2e |

## 8. Out of scope (Round 2)

Real sensor ingestion (OPC-UA/MQTT adapters are the documented integration point), multi-plant tenancy, native mobile apps, closed-loop actuation (Sentinel never actuates hardware — by design, not limitation).

## 9. Future roadmap

Q3: OPC-UA/MQTT live telemetry adapter; Enkrypt custom-policy builder UI for plant-specific safety rulesets. Q4: SAP PM & Maximo certified connectors; predictive mode (act on degradation trends before the fault). Y2: cross-plant federated memory with per-site privacy boundaries.
