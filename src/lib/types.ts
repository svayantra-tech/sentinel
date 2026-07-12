// ─────────────────────────────────────────────────────────────────────────────
// Sentinel — core domain types
// Traceability: these types realise the data model in docs/PRD.md §9 (FR-03..FR-11)
// ─────────────────────────────────────────────────────────────────────────────
import { z } from 'zod';

// ── Equipment & faults (FR-01) ───────────────────────────────────────────────
export const EquipmentType = z.enum(['centrifugal_pump', 'compressor', 'conveyor']);
export type EquipmentType = z.infer<typeof EquipmentType>;

export const FaultInput = z.object({
  equipmentId: z.string().min(2).max(40),
  equipmentType: EquipmentType,
  plantId: z.string().min(2).max(20),
  faultCode: z.string().min(2).max(40),
  description: z.string().min(5).max(2000),
  severity: z.enum(['critical', 'high', 'medium']),
  reportedBy: z.enum(['sensor', 'operator']),
});
export type FaultInput = z.infer<typeof FaultInput>;

// ── Qdrant payload schemas (FR-03/FR-04/FR-05 — PRD §9) ──────────────────────
export interface IncidentPayload {
  kind: 'incident';
  equipment_id: string;
  equipment_type: EquipmentType;
  plant_id: string;
  fault_code: string;
  fault_description: string;
  root_cause: string;
  fix_applied: string;
  time_to_resolve_minutes: number;
  severity: 'critical' | 'high' | 'medium';
  outcome: 'resolved' | 'escalated';
  technician_id: string;
  timestamp: string; // ISO-8601
  /** true ONLY on incidents written back by a workflow run — never on the seeded
   *  corpus. This is the marker "Reset Demo" deletes by; without it, seeded and
   *  run-generated points are indistinguishable. */
  demo_generated?: boolean;
}

export interface ManualPayload {
  kind: 'manual';
  equipment_type: EquipmentType;
  manufacturer: string;
  section_type: 'maintenance' | 'safety' | 'torque_specs' | 'lockout_tagout';
  chapter: string;
  page_range: string;
  text: string;
}

export interface RunbookPayload {
  kind: 'runbook';
  equipment_type: EquipmentType;
  fault_category: string;
  title: string;
  skill_level_required: 1 | 2 | 3;
  estimated_minutes: number;
  safety_rating: 'safe' | 'caution' | 'danger';
  steps: string[];
}

// ── Runbook produced by the agent (FR-06) ────────────────────────────────────
export const RunbookStep = z.object({
  n: z.number().int().min(1),
  action: z.string().min(5),
  verification: z.string().min(3),
  ppe: z.string().optional(),
});
export const DraftRunbook = z.object({
  title: z.string(),
  faultHypothesis: z.string(),
  steps: z.array(RunbookStep).min(3).max(12),
  estimatedMinutes: z.number().int().positive(),
});
export type DraftRunbook = z.infer<typeof DraftRunbook>;

// ── Safety gate results (FR-08/FR-09 — Enkrypt triple-mode) ──────────────────
export type ViolationType =
  | 'HALLUCINATED_SPEC'      // Mode 1 — numeric spec contradicts OEM ground truth
  | 'LOTO_BYPASS'            // Mode 2 — energised work without isolation first
  | 'INTERLOCK_DISABLE'      // Mode 2 — proposes defeating a safety device
  | 'AUTH_EXCEEDED'          // Mode 2 — step exceeds technician authorisation
  | 'BLAME_BIAS'             // Mode 3 — post-mortem blames operator without evidence
  | 'TOXICITY'               // Enkrypt cloud detector
  | 'PII_LEAK';              // Enkrypt cloud detector

export interface SafetyViolation {
  type: ViolationType;
  stepN?: number;
  severity: 'block' | 'warn';
  detail: string;
  evidence?: string;          // the OEM text / rule that triggered it
  correction?: string;        // safe replacement (when derivable)
  source: 'enkrypt' | 'local';
}

export interface SafetyReport {
  checkedAt: string;
  mode: 'runbook' | 'postmortem';
  violations: SafetyViolation[];
  blockedSteps: number[];
  cloudUsed: boolean;         // did Enkrypt cloud respond
}

// ── Scorer results (FR-07 — Mastra scorers) ──────────────────────────────────
export interface ScoreCard {
  relevance: number;          // 0..1 — grounded in retrieved OEM/incident context
  safety: number;             // 0..1 — deterministic safety rubric
  completeness: number;       // 0..1 — structural rubric
  pass: boolean;              // all >= 0.75 (NFR-02 threshold)
  reasons: string[];
  attempt: number;
}

// ── Workflow run state exposed to the UI ─────────────────────────────────────
export type RunStage =
  | 'FAULT_INGESTED' | 'CONTEXT_RETRIEVED' | 'RUNBOOK_DRAFTED' | 'SCORED'
  | 'SAFETY_CHECKED' | 'SUSPENDED' | 'TECHNICIAN_APPROVED' | 'EXECUTING'
  | 'POST_MORTEM' | 'MEMORY_WRITTEN' | 'DONE' | 'FAILED';

export interface RetrievedContext {
  incidents: Array<{ score: number; payload: IncidentPayload }>;
  manualChunks: Array<{ score: number; payload: ManualPayload }>;
  runbooks: Array<{ score: number; payload: RunbookPayload }>;
  filters: Record<string, string | number>;
}

export interface SentinelRunView {
  runId: string;
  correlationId: string;
  stage: RunStage;
  fault: FaultInput;
  workOrderId?: string;
  context?: RetrievedContext;
  runbook?: DraftRunbook;
  scorecard?: ScoreCard;
  safety?: SafetyReport;
  correctedRunbook?: DraftRunbook;
  approval?: { approved: boolean; technicianId: string; notes?: string; at: string };
  postMortem?: string;
  postMortemSafety?: SafetyReport;
  memoryPointId?: string;
  timeline: Array<{ at: string; stage: RunStage; note: string }>;
  startedAt: string;
  finishedAt?: string;
}

// ── Auth (FR-13) ─────────────────────────────────────────────────────────────
export interface SessionUser {
  sub: string;
  name: string;
  role: 'technician' | 'supervisor';
  authLevel: 1 | 2 | 3;       // gates runbook_library retrieval (PRD §11)
}
