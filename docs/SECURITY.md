# Sentinel — Security Specification

**Direct response to Round-1 feedback:** *"missing explicit API security specifications (JWT/OAuth2, rate limiting, input validation) and data encryption standards."*

## 1. Authentication & authorization (FR-13)

- **JWT (HS256 via `jose`)**, 8h expiry, issuer-pinned. Claims: `sub`, `role` (technician|supervisor), **`authLevel` (1–3)**. Accepted as `Authorization: Bearer` or httpOnly `sentinel_token` cookie (SameSite=Lax, Secure in production).
- **Authorization is enforced in the retrieval layer, not just the routes**: the technician's `authLevel` becomes a Qdrant payload filter (`skill_level_required ≤ authLevel`). An L1 technician doesn't get *blocked from* a danger-rated L2 procedure — the agent **can't even retrieve it** on their behalf. Least privilege applied to vector search.
- Demo directory (`DEMO_USERS`) is explicitly a stand-in; production path = OIDC/SSO (Entra ID/Okta) issuing the same claim shape — one function swap in `src/lib/auth.ts`.

## 2. Input validation (NFR-03)

Every API body passes a **Zod schema before touching the agent** (`parseBody()`): strict types, length caps, enums. Failures → 422 with field-level issues. The workflow state itself is schema-validated at each Mastra step boundary.

## 3. Rate limiting (NFR-03)

Token bucket per client (IP / token suffix): **60 req/min, burst 20**, 429 + `retry-after`. In-memory for the demo; the production note: swap the Map for Redis (same interface) behind an API gateway.

## 4. Encryption standards

- **In transit:** TLS 1.3 terminated at the platform edge (Vercel/Railway enforce HTTPS; on-prem: nginx/traefik with TLS 1.3 + HSTS).
- **At rest:** Qdrant Cloud and Turso encrypt at rest with AES-256; self-hosted guidance = LUKS/EBS-encrypted volumes.
- **Secrets:** env only (12-Factor), never committed (`.gitignore`), `JWT_SECRET` generated via `openssl rand -hex 32`; LLM keys support rotation *by design* (comma-separated `LLM_API_KEYS` are round-robined, so key rollover is zero-downtime).
- Mastra's observability pipeline runs its `SensitiveDataFilter` by default, so exported spans redact secret-shaped values.

## 5. Agent-specific safety boundaries

- The LLM **never executes anything**: Mastra `suspend()` sits between generation and action — the only resume path is an authenticated, rate-limited, validated HTTP call (409 unless the run is genuinely `SUSPENDED`).
- Enkrypt cloud + local deterministic guardrails run **in parallel and union** their findings — an external outage cannot open a safety hole (NFR-04).
- Prompt-injection surface: retrieved corpus text is plant-controlled data; Enkrypt's `injection_attack` detector additionally screens gate inputs when the cloud key is present.

## 6. Audit

Every state transition is timestamped in the run timeline; every span carries the correlation ID; work orders persist resolution records. An incident is reconstructable end-to-end from traces alone.
