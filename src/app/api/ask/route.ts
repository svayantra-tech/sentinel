// POST /api/ask — "Ask Sentinel" on the landing page. Calls the REAL configured
// LLM (Groq via the existing LLM_* env) with an honest system prompt about what
// Sentinel actually is. Public (the landing page is public) but rate-limited.
// Graceful failure: if the model is unreachable, say so — never a canned fake.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit, parseBody } from '@/lib/auth';
import { chat } from '@/lib/llm';

export const maxDuration = 30;

const AskBody = z.object({ question: z.string().min(3).max(400) });

const SYSTEM = `You are Sentinel, an autonomous factory maintenance copilot built for a hackathon.
Answer visitor questions concisely (under 130 words), plainly, and honestly. Facts about you:
- Six-step Mastra workflow: fault ingest (CMMS work order via a real MCP tool) → Qdrant retrieval →
  LLM runbook draft → deterministic Mastra scorers (self-refine below 0.75) → safety gate →
  genuine human-in-the-loop suspend/resume (durable in Turso/libSQL) → execution → blameless
  post-mortem → memory write-back (the flywheel).
- Qdrant: 3 collections (incident_history, oem_manuals, runbook_library); every retrieval is semantic
  search PLUS hard payload filters (equipment_type, technician auth level).
- Safety gate: LOCAL deterministic checks (numeric specs vs OEM ground truth, LOTO ordering,
  interlock tampering, auth level) with Enkrypt AI cloud guardrails running in parallel. Blocked
  steps are corrected or removed before a human ever sees them.
- Data: a 15-year SYNTHESIZED corpus — 2,800+ incidents modeled on real-world failure modes and
  public datasets (NASA C-MAPSS, AI4I). It is NOT real factory production data.
- 100% TypeScript. LLM inference via Groq (llama-3.3-70b-versatile) in live mode; a deterministic
  scripted mode exists for reproducible demos.
- Connecting to a real factory would mean pointing the MCP CMMS tool at SAP PM/Maximo, ingesting real
  sensor/alarm feeds, and seeding Qdrant from the plant's actual incident history and OEM manuals.
If asked something you don't know, say you don't know. Never invent metrics or claim real deployments.`;

export async function POST(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const body = await parseBody(req, AskBody);
  if ('error' in body) return body.error;

  const outcome = await chat({
    system: SYSTEM,
    user: body.data.question,
    correlationId: 'landing-ask',
    step: 'ask-sentinel',
    temperature: 0.4,
    maxTokens: 400,
  });

  if (!outcome.ok) {
    console.error('[POST /api/ask] LLM unavailable:', outcome.reason);
    return NextResponse.json(
      { error: 'The model is unreachable right now — please try again in a moment.' },
      { status: 503 },
    );
  }
  return NextResponse.json({ answer: outcome.result.text, model: outcome.result.model, provider: outcome.result.provider });
}
