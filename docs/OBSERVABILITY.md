# Sentinel — LLM Observability

**Direct response to the highest-priority Round-1 feedback:** *"complete absence of LLM observability and tracing (OpenTelemetry)."* This is now the most instrumented part of the system — and it's user-visible.

## Architecture (three layers, defence in depth)

1. **OpenTelemetry spans** (`@opentelemetry/api`) via one instrumentation entrypoint — `traceStep()` in `src/lib/telemetry.ts` — wrapping every workflow step, Qdrant search/upsert, Enkrypt gate, MCP call, and scorer run.
2. **OTLP export** — `src/instrumentation.ts` (Next.js instrumentation hook) boots a NodeTracerProvider + BatchSpanProcessor when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. `docker compose up -d` → Jaeger UI at **localhost:16686**. Mastra's own 1.x `Observability` registry additionally persists framework spans to Mastra storage.
3. **In-app TraceStore** — a bounded ring buffer (500 events) feeding `/api/traces` and the **Observability tab**, so live traces are demoable with *zero external dependencies*. The demo never depends on Jaeger being up.

## GenAI semantic conventions

Every LLM call records: `gen_ai.request.model`, `gen_ai.system` (provider), `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, latency, `sentinel.llm.fallback_used`, and **`sentinel.prompt.hash`** — the SHA-256 of the CRISPE template, making prompt drift observable in production (see PROMPTS.md).

## Correlation

One `correlationId` (`snl-xxxxxxxx`) is minted per run and stamped on **every** span across workflow/LLM/Qdrant/Enkrypt/MCP/scorer — the Observability tab filters by it, so a judge can watch a single fault flow through every subsystem.

## Span kinds & what they prove

| kind | spans | proves |
|---|---|---|
| `workflow` | draft/refine/execute | step latency, attempt counts (self-refinement visible as attempt 2) |
| `qdrant` | search per collection + upsert | which filters ran, backend used, the write-back |
| `enkrypt` | gate.runbook / gate.postmortem + **⛔ blocked.\*** (red) | what was checked, what was caught, cloud vs local |
| `mcp` | cmms.createWorkOrder / updateWorkOrder | external-system side effects |
| `scorer` | runbook scoring per attempt | deterministic quality gating |
| `llm` | per call w/ GenAI attrs | cost, latency, model, fallback, prompt version |

## Header metrics

The tab aggregates: total runs, LLM calls, tokens in/out, average LLM latency, and the **⛔ blocked count** — the safety KPI a plant manager actually cares about.
