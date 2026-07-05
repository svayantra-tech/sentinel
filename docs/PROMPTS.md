# Sentinel — Prompt Engineering (CRISPE)

**Direct response to Round-1 feedback:** *"lack of production-grade prompt engineering specifications (CRISPE framework) and few-shot examples."*

All prompts live in one versioned module: [`src/mastra/prompts.ts`](../src/mastra/prompts.ts).

## The CRISPE structure

Every system prompt is written in five labelled sections:

| Letter | Section | What it does in Sentinel |
|---|---|---|
| **C** | Capacity & Role | Pins the persona AND its authority boundary — e.g. the runbook writer explicitly "has NO authority to execute anything" |
| **R** | (Role, merged with C) | |
| **I** | Insight | Declares the runtime context contract: past incidents = what worked here, OEM extracts = the *only* legal source of numbers |
| **S** | Statement | The precise task with hard rules (LOTO must be step 1; never invent a number — write "per OEM manual") |
| **P** | Personality | Calibrated for a safety domain: "would rather say escalate than guess", "blameless-by-default" |
| **E** | Experiment | The output contract (strict JSON schema) **plus few-shot pairs** |

## Few-shot design rationale

Each prompt carries a **contrastive pair** — one GOOD and one BAD example — because the failure mode we're steering away from is specific and dangerous:

- **Runbook prompt:** GOOD = "blow fins at maximum 6 bar (OEM 5.2)" (number + citation). BAD = "blow fins at 10 bar" with the annotation *"inventing numbers gets people hurt."* Contrastive examples outperform positive-only examples at suppressing spec invention.
- **Post-mortem prompt:** GOOD root cause = physical mechanism. BAD = "operator error caused the failure" annotated as forbidden without evidence. This pre-empts the bias the Enkrypt Mode-3 gate would otherwise have to catch downstream — defence in depth starts in the prompt.
- **Refinement prompt:** instructs *surgical* edits only ("change the minimum necessary") so scorer-driven regeneration can't thrash passing content.

## Prompt versioning & drift observability

Templates are string constants → `promptHash()` (SHA-256, 12 hex chars) is attached to **every LLM span** as `sentinel.prompt.hash` (see the Observability tab). If anyone edits a prompt, the hash changes in production traces immediately — prompt drift is a first-class observable, not a mystery. This closes the loop between prompt engineering and the NFR-01 observability requirement.

## Runtime prompt assembly

User prompts are assembled from retrieved context by `contextToPromptBlocks()` (`src/mastra/logic.ts`): incidents carry their similarity %, OEM chunks carry manufacturer/chapter/page citations (so the model can cite them back), runbooks carry skill level + safety rating. Temperature 0.15 for drafting (precision domain), JSON response format requested, output re-validated with Zod before anything downstream trusts it.
