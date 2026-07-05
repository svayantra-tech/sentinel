// ─────────────────────────────────────────────────────────────────────────────
// Sentinel analytics — the derived-aggregate layer over the 15-year corpus.
//
// Everything the operational surfaces show (fleet health, asset dossiers, the
// executive Insights dashboard, the incident browser, technician stats, the
// work-order queue) is COMPUTED here from buildFullHistory() — nothing is
// hardcoded. Heavy derivations are memoised at module scope; the corpus is
// deterministic so these caches are stable for the process lifetime.
// ─────────────────────────────────────────────────────────────────────────────
import { buildFullHistory } from '@/data/seed-corpus';
import { ASSETS, ASSET_BY_ID, PLANTS, TECHNICIANS, FAULT_LIBRARY, makeCost, type Asset, type HistoryIncident } from '@/data/history';
import type { EquipmentType } from './types';

const DAY = 24 * 3600 * 1000;
const yearOf = (iso: string) => Number(iso.slice(0, 4));
const monthKey = (iso: string) => iso.slice(0, 7); // YYYY-MM
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const round = (n: number, d = 0) => { const f = 10 ** d; return Math.round(n * f) / f; };

// ── Core memoised indexes ────────────────────────────────────────────────────
let _all: HistoryIncident[] | null = null;
function all(): HistoryIncident[] { return (_all ??= buildFullHistory()); }

let _nowMs: number | null = null;
/** "Now" is anchored to the latest incident so recency windows stay meaningful. */
export function nowMs(): number {
  if (_nowMs != null) return _nowMs;
  _nowMs = Math.max(...all().map((h) => Date.parse(h.payload.timestamp)));
  return _nowMs;
}

let _byAsset: Map<string, HistoryIncident[]> | null = null;
function byAsset(): Map<string, HistoryIncident[]> {
  if (_byAsset) return _byAsset;
  const m = new Map<string, HistoryIncident[]>();
  for (const h of all()) {
    const a = m.get(h.payload.equipment_id) ?? [];
    a.push(h);
    m.set(h.payload.equipment_id, a);
  }
  for (const a of m.values()) a.sort((x, y) => x.payload.timestamp.localeCompare(y.payload.timestamp));
  _byAsset = m;
  return m;
}

// ── Savings model — the flywheel in rupees ───────────────────────────────────
// Counterfactual: had MTTR stayed at the early-era (2011-2013) baseline for each
// fault code, downtime cost would be higher. Saved ₹ = actual downtime cost ×
// (baselineMTTR / actualMTTR − 1). Ties the ₹ story directly to the MTTR decline.
function buildBaseline(hist: HistoryIncident[]): Map<string, number> {
  const early = hist.filter((h) => yearOf(h.payload.timestamp) <= 2013);
  const byCode = new Map<string, number[]>();
  for (const h of early) {
    const a = byCode.get(h.payload.fault_code) ?? [];
    a.push(h.payload.time_to_resolve_minutes);
    byCode.set(h.payload.fault_code, a);
  }
  const overall = mean(early.map((h) => h.payload.time_to_resolve_minutes)) || 160;
  const m = new Map<string, number>();
  for (const [code, xs] of byCode) m.set(code, mean(xs));
  m.set('__overall__', overall);
  return m;
}
let _baseline: Map<string, number> | null = null;
function baselineMTTR(): Map<string, number> { return (_baseline ??= buildBaseline(all())); }
function savedINRWith(h: HistoryIncident, base: Map<string, number>): number {
  const bl = base.get(h.payload.fault_code) ?? base.get('__overall__')!;
  const actual = h.payload.time_to_resolve_minutes;
  if (actual >= bl) return 0;
  return Math.max(0, Math.round(h.cost.downtimeCostINR * (bl / actual - 1)));
}
function savedMinutesWith(h: HistoryIncident, base: Map<string, number>): number {
  const bl = base.get(h.payload.fault_code) ?? base.get('__overall__')!;
  return Math.max(0, bl - h.payload.time_to_resolve_minutes);
}
function savedINR(h: HistoryIncident): number { return savedINRWith(h, baselineMTTR()); }
function savedMinutes(h: HistoryIncident): number { return savedMinutesWith(h, baselineMTTR()); }

// ── Asset summaries (GET /api/assets) ────────────────────────────────────────
export interface AssetSummary {
  id: string; type: EquipmentType; plantId: string; name: string;
  manufacturer: string; model: string; tier: Asset['tier']; installDate: string;
  health: number; mtbfDays: number; openWorkOrders: number;
  trend: 'up' | 'down' | 'flat'; incidentCount: number;
  lastIncident: { faultCode: string; severity: string; timestamp: string; summary: string } | null;
}

function healthScore(hist: HistoryIncident[]): number {
  const now = nowMs();
  // Trailing-12-month failure burden is what a reliability engineer watches: how
  // often, how badly, and how recently this asset has bitten. Longer since the
  // last failure recovers health; frequent recent severe faults tank it.
  const sevW = { critical: 12, high: 6, medium: 3 } as const;
  const recent365 = hist.filter((h) => now - Date.parse(h.payload.timestamp) <= 365 * DAY);
  let score = 96;
  score -= recent365.length * 3.5;
  score -= recent365.reduce((s, h) => s + sevW[h.payload.severity], 0) * 0.9;
  score -= recent365.filter((h) => h.payload.outcome === 'escalated').length * 7;
  const last = hist[hist.length - 1];
  if (last) {
    const daysSince = (now - Date.parse(last.payload.timestamp)) / DAY;
    score += Math.min(14, daysSince / 45); // reward a quiet spell
  } else {
    score = 97;
  }
  return Math.round(Math.max(12, Math.min(98, score)));
}

function assetName(a: Asset): string {
  const label: Record<EquipmentType, string> = {
    centrifugal_pump: 'Pump', compressor: 'Compressor', conveyor: 'Conveyor',
  };
  return `${a.manufacturer} ${a.model} — ${label[a.type]} ${a.id}`;
}

function summarizeAsset(a: Asset): AssetSummary {
  const now = nowMs();
  const hist = byAsset().get(a.id) ?? [];
  const activeDays = Math.max(1, (now - Date.parse(a.installDate)) / DAY);
  const mtbfDays = hist.length ? round(activeDays / hist.length, 1) : round(activeDays, 1);
  const last = hist[hist.length - 1] ?? null;
  const r180 = hist.filter((h) => now - Date.parse(h.payload.timestamp) <= 180 * DAY).length;
  const p180 = hist.filter((h) => { const d = now - Date.parse(h.payload.timestamp); return d > 180 * DAY && d <= 360 * DAY; }).length;
  const trend: AssetSummary['trend'] = r180 > p180 ? 'up' : r180 < p180 ? 'down' : 'flat';
  const openWorkOrders = hist.filter((h) => h.payload.outcome === 'escalated' && now - Date.parse(h.payload.timestamp) <= 150 * DAY).length;
  return {
    id: a.id, type: a.type, plantId: a.plantId, name: assetName(a),
    manufacturer: a.manufacturer, model: a.model, tier: a.tier, installDate: a.installDate,
    health: healthScore(hist), mtbfDays, openWorkOrders, trend, incidentCount: hist.length,
    lastIncident: last ? {
      faultCode: last.payload.fault_code, severity: last.payload.severity,
      timestamp: last.payload.timestamp,
      summary: `${last.payload.root_cause}`,
    } : null,
  };
}

let _assetSummaries: AssetSummary[] | null = null;
export function assetSummaries(): AssetSummary[] {
  return (_assetSummaries ??= ASSETS.map(summarizeAsset));
}
export function assetSummary(id: string): AssetSummary | null {
  const a = ASSET_BY_ID.get(id);
  return a ? summarizeAsset(a) : null;
}

// ── Asset dossier (GET /api/assets/[id]) ─────────────────────────────────────
export interface AssetDossier {
  summary: AssetSummary;
  failureModes: Array<{ faultCode: string; count: number; avgMttr: number }>;
  mtbfSeries: Array<{ year: number; mtbfDays: number; incidents: number }>;
  mttrSeries: Array<{ year: number; avgMttr: number }>;
  totals: { incidents: number; downtimeHours: number; costINR: number; savedINR: number };
  incidents: Array<IncidentRow>;
}

export function assetDossier(id: string): AssetDossier | null {
  const s = assetSummary(id);
  if (!s) return null;
  const a = ASSET_BY_ID.get(id)!;
  const hist = byAsset().get(id) ?? [];
  const byCode = new Map<string, HistoryIncident[]>();
  for (const h of hist) { const arr = byCode.get(h.payload.fault_code) ?? []; arr.push(h); byCode.set(h.payload.fault_code, arr); }
  const failureModes = [...byCode.entries()]
    .map(([faultCode, xs]) => ({ faultCode, count: xs.length, avgMttr: round(mean(xs.map((h) => h.payload.time_to_resolve_minutes))) }))
    .sort((x, y) => y.count - x.count);

  const installYear = yearOf(a.installDate);
  const byYear = new Map<number, HistoryIncident[]>();
  for (const h of hist) { const y = yearOf(h.payload.timestamp); const arr = byYear.get(y) ?? []; arr.push(h); byYear.set(y, arr); }
  const mtbfSeries: AssetDossier['mtbfSeries'] = [];
  const mttrSeries: AssetDossier['mttrSeries'] = [];
  for (let y = Math.max(2011, installYear); y <= 2025; y++) {
    const xs = byYear.get(y) ?? [];
    mtbfSeries.push({ year: y, mtbfDays: xs.length ? round(365 / xs.length, 1) : 0, incidents: xs.length });
    if (xs.length) mttrSeries.push({ year: y, avgMttr: round(mean(xs.map((h) => h.payload.time_to_resolve_minutes))) });
  }

  const totals = {
    incidents: hist.length,
    downtimeHours: round(hist.reduce((s, h) => s + h.cost.downtimeMinutes, 0) / 60),
    costINR: hist.reduce((s, h) => s + h.cost.downtimeCostINR + h.cost.partsCostINR + h.cost.laborCostINR, 0),
    savedINR: hist.reduce((s, h) => s + savedINR(h), 0),
  };

  const incidents = [...hist].reverse().map(toRow);
  return { summary: s, failureModes, mtbfSeries, mttrSeries, totals, incidents };
}

// ── Org-wide analytics (GET /api/analytics) ──────────────────────────────────
export interface OrgAnalytics {
  kpis: {
    incidentsResolved: number; downtimeHoursPrevented: number; rupeesSaved: number;
    avgMttr2011: number; avgMttrNow: number; mttrImprovementPct: number;
    fleetSize: number; plants: number;
  };
  incidentsPerMonth: Array<{ month: string; count: number }>;
  mttrTrend: Array<{ year: number; avgMttr: number }>;
  downtimeCostPerYear: Array<{ year: number; costINR: number }>;
  cumulativeSavings: Array<{ year: number; savedINR: number }>;
  topFailureModes: Array<{ faultCode: string; count: number; avgMttr: number }>;
  plantComparison: Array<{ plantId: string; name: string; region: string; assets: number; incidents: number; avgMttr: number; costINR: number }>;
  source: 'array' | 'qdrant';        // which system-of-record produced these numbers
  pointsScrolled: number;            // how many points were aggregated (Qdrant scroll count)
}

let _org: OrgAnalytics | null = null;
export function orgAnalytics(): OrgAnalytics {
  return (_org ??= computeOrg(all(), 'array'));
}

/** Aggregate an arbitrary incident list — the same math whether the list came
 *  from the generated array or was scrolled straight out of Qdrant. */
function computeOrg(hist: HistoryIncident[], source: 'array' | 'qdrant'): OrgAnalytics {
  const baseline = buildBaseline(hist);
  const saved = (h: HistoryIncident) => savedINRWith(h, baseline);
  const savedMin = (h: HistoryIncident) => savedMinutesWith(h, baseline);

  const perMonth = new Map<string, number>();
  const perYearMttr = new Map<number, number[]>();
  const perYearCost = new Map<number, number>();
  const perYearSaved = new Map<number, number>();
  const modeCount = new Map<string, { count: number; mttr: number[] }>();
  for (const h of hist) {
    const p = h.payload;
    perMonth.set(monthKey(p.timestamp), (perMonth.get(monthKey(p.timestamp)) ?? 0) + 1);
    const y = yearOf(p.timestamp);
    (perYearMttr.get(y) ?? perYearMttr.set(y, []).get(y)!).push(p.time_to_resolve_minutes);
    perYearCost.set(y, (perYearCost.get(y) ?? 0) + h.cost.downtimeCostINR + h.cost.partsCostINR + h.cost.laborCostINR);
    perYearSaved.set(y, (perYearSaved.get(y) ?? 0) + saved(h));
    const mc = modeCount.get(p.fault_code) ?? { count: 0, mttr: [] };
    mc.count++; mc.mttr.push(p.time_to_resolve_minutes); modeCount.set(p.fault_code, mc);
  }

  const incidentsPerMonth: OrgAnalytics['incidentsPerMonth'] = [];
  for (let y = 2011; y <= 2025; y++) for (let m = 1; m <= 12; m++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    incidentsPerMonth.push({ month: key, count: perMonth.get(key) ?? 0 });
  }

  const mttrTrend: OrgAnalytics['mttrTrend'] = [];
  const downtimeCostPerYear: OrgAnalytics['downtimeCostPerYear'] = [];
  const cumulativeSavings: OrgAnalytics['cumulativeSavings'] = [];
  let cum = 0;
  for (let y = 2011; y <= 2025; y++) {
    mttrTrend.push({ year: y, avgMttr: round(mean(perYearMttr.get(y) ?? [])) });
    downtimeCostPerYear.push({ year: y, costINR: perYearCost.get(y) ?? 0 });
    cum += perYearSaved.get(y) ?? 0;
    cumulativeSavings.push({ year: y, savedINR: cum });
  }

  const topFailureModes = [...modeCount.entries()]
    .map(([faultCode, v]) => ({ faultCode, count: v.count, avgMttr: round(mean(v.mttr)) }))
    .sort((a, b) => b.count - a.count).slice(0, 8);

  const plantComparison = PLANTS.map((pl) => {
    const inc = hist.filter((h) => h.payload.plant_id === pl.id);
    return {
      plantId: pl.id, name: pl.name, region: pl.region,
      assets: ASSETS.filter((a) => a.plantId === pl.id).length,
      incidents: inc.length,
      avgMttr: round(mean(inc.map((h) => h.payload.time_to_resolve_minutes))),
      costINR: inc.reduce((s, h) => s + h.cost.downtimeCostINR + h.cost.partsCostINR + h.cost.laborCostINR, 0),
    };
  });

  const avgMttr2011 = round(mean(perYearMttr.get(2011) ?? []));
  const avgMttrNow = round(mean(perYearMttr.get(2025) ?? []));
  return {
    kpis: {
      incidentsResolved: hist.filter((h) => h.payload.outcome === 'resolved').length,
      downtimeHoursPrevented: Math.round(hist.reduce((s, h) => s + savedMin(h), 0) / 60),
      rupeesSaved: hist.reduce((s, h) => s + saved(h), 0),
      avgMttr2011, avgMttrNow,
      mttrImprovementPct: avgMttr2011 ? round(100 * (1 - avgMttrNow / avgMttr2011)) : 0,
      fleetSize: ASSETS.length, plants: PLANTS.length,
    },
    incidentsPerMonth, mttrTrend, downtimeCostPerYear, cumulativeSavings, topFailureModes, plantComparison,
    source, pointsScrolled: hist.length,
  };
}

/** Qdrant-as-system-of-record analytics: scroll every incident point out of the
 *  store, reconstruct the (deterministic) cost per payload, and aggregate those.
 *  Gated on QDRANT_URL — falls back to the generated array otherwise, so numbers
 *  always render. Now every figure on /analytics provably traces to Qdrant. */
export async function orgAnalyticsFromQdrant(): Promise<OrgAnalytics> {
  if (!process.env.QDRANT_URL?.trim()) return orgAnalytics();
  const { scrollAllIncidents } = await import('./memory');
  const payloads = await scrollAllIncidents();
  if (!payloads.length) return orgAnalytics();
  const hist: HistoryIncident[] = payloads.map((p, i) => ({
    id: `QP-${i}`,
    payload: p,
    cost: makeCost(p.equipment_id, p.time_to_resolve_minutes, p.severity, p.outcome === 'escalated'),
  }));
  return computeOrg(hist, 'qdrant');
}

// ── Incident browser (GET /api/incidents) ────────────────────────────────────
export interface IncidentRow {
  id: string; equipmentId: string; equipmentType: EquipmentType; plantId: string;
  faultCode: string; faultDescription: string; rootCause: string; fixApplied: string;
  severity: string; outcome: string; technicianId: string; timestamp: string;
  mttrMinutes: number; downtimeCostINR: number; partsCostINR: number; laborHours: number; laborCostINR: number;
}
function toRow(h: HistoryIncident): IncidentRow {
  const p = h.payload;
  return {
    id: h.id, equipmentId: p.equipment_id, equipmentType: p.equipment_type, plantId: p.plant_id,
    faultCode: p.fault_code, faultDescription: p.fault_description, rootCause: p.root_cause, fixApplied: p.fix_applied,
    severity: p.severity, outcome: p.outcome, technicianId: p.technician_id, timestamp: p.timestamp,
    mttrMinutes: p.time_to_resolve_minutes, downtimeCostINR: h.cost.downtimeCostINR,
    partsCostINR: h.cost.partsCostINR, laborHours: h.cost.laborHours, laborCostINR: h.cost.laborCostINR,
  };
}

export interface IncidentQuery {
  plant?: string; equipmentId?: string; equipmentType?: string; faultCode?: string;
  severity?: string; outcome?: string; from?: string; to?: string;
  sort?: 'timestamp' | 'mttr' | 'cost'; dir?: 'asc' | 'desc';
  page?: number; pageSize?: number;
}
export interface IncidentPage {
  rows: IncidentRow[]; total: number; page: number; pageSize: number; pages: number;
  facets: { plants: string[]; equipmentTypes: string[]; faultCodes: string[]; severities: string[]; outcomes: string[] };
}

export function queryIncidents(q: IncidentQuery): IncidentPage {
  const hist = all();
  let rows = hist.filter((h) => {
    const p = h.payload;
    if (q.plant && p.plant_id !== q.plant) return false;
    if (q.equipmentId && p.equipment_id !== q.equipmentId) return false;
    if (q.equipmentType && p.equipment_type !== q.equipmentType) return false;
    if (q.faultCode && p.fault_code !== q.faultCode) return false;
    if (q.severity && p.severity !== q.severity) return false;
    if (q.outcome && p.outcome !== q.outcome) return false;
    if (q.from && p.timestamp < q.from) return false;
    if (q.to && p.timestamp > q.to) return false;
    return true;
  }).map(toRow);

  const sort = q.sort ?? 'timestamp';
  const dir = q.dir ?? 'desc';
  rows.sort((a, b) => {
    const cmp = sort === 'mttr' ? a.mttrMinutes - b.mttrMinutes
      : sort === 'cost' ? a.downtimeCostINR - b.downtimeCostINR
      : a.timestamp.localeCompare(b.timestamp);
    return dir === 'asc' ? cmp : -cmp;
  });

  const total = rows.length;
  const pageSize = Math.min(200, Math.max(5, q.pageSize ?? 25));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pages, Math.max(1, q.page ?? 1));
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize), total, page, pageSize, pages,
    facets: facets(),
  };
}

let _facets: IncidentPage['facets'] | null = null;
function facets(): IncidentPage['facets'] {
  if (_facets) return _facets;
  const plants = [...new Set(all().map((h) => h.payload.plant_id))].sort();
  const equipmentTypes = [...new Set(all().map((h) => h.payload.equipment_type))].sort();
  const faultCodes = [...new Set(all().map((h) => h.payload.fault_code))].sort();
  _facets = { plants, equipmentTypes, faultCodes, severities: ['critical', 'high', 'medium'], outcomes: ['resolved', 'escalated'] };
  return _facets;
}

// ── Technicians (GET /api/technicians) ───────────────────────────────────────
export interface TechnicianSummary {
  id: string; name: string; skill: number; plantId: string; specialization: string; hireDate: string;
  resolutions: number; escalations: number; avgMttr: number; topAssets: Array<{ id: string; count: number }>;
}
let _techs: TechnicianSummary[] | null = null;
export function technicianSummaries(): TechnicianSummary[] {
  if (_techs) return _techs;
  const byTech = new Map<string, HistoryIncident[]>();
  for (const h of all()) { const arr = byTech.get(h.payload.technician_id) ?? []; arr.push(h); byTech.set(h.payload.technician_id, arr); }
  _techs = TECHNICIANS.map((t) => {
    const hist = byTech.get(t.id) ?? [];
    const assetCount = new Map<string, number>();
    for (const h of hist) assetCount.set(h.payload.equipment_id, (assetCount.get(h.payload.equipment_id) ?? 0) + 1);
    const topAssets = [...assetCount.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count).slice(0, 3);
    return {
      id: t.id, name: t.name, skill: t.skill, plantId: t.plantId, specialization: t.specialization, hireDate: t.hireDate,
      resolutions: hist.filter((h) => h.payload.outcome === 'resolved').length,
      escalations: hist.filter((h) => h.payload.outcome === 'escalated').length,
      avgMttr: round(mean(hist.map((h) => h.payload.time_to_resolve_minutes))),
      topAssets,
    };
  }).sort((a, b) => b.resolutions - a.resolutions);
  return _techs;
}
export function technicianSummary(id: string): TechnicianSummary | null {
  return technicianSummaries().find((t) => t.id === id) ?? null;
}

// ── Work orders (GET /api/workorders) ────────────────────────────────────────
export interface WorkOrder {
  id: string; assetId: string; plantId: string; faultCode: string; severity: string;
  status: 'open' | 'in_progress' | 'closed'; openedAt: string; technicianId: string; description: string; source: 'history' | 'live';
}
export function workOrdersFromHistory(limit = 40): WorkOrder[] {
  const now = nowMs();
  const recent = [...all()]
    .sort((a, b) => b.payload.timestamp.localeCompare(a.payload.timestamp))
    .slice(0, limit);
  return recent.map((h, i) => {
    const p = h.payload;
    const ageDays = (now - Date.parse(p.timestamp)) / DAY;
    const status: WorkOrder['status'] = p.outcome === 'escalated' && ageDays <= 150 ? 'open'
      : ageDays <= 20 ? 'in_progress' : 'closed';
    return {
      id: `WO-${h.id.replace(/[^0-9]/g, '').slice(-6).padStart(6, '0')}${i % 10}`,
      assetId: p.equipment_id, plantId: p.plant_id, faultCode: p.fault_code, severity: p.severity,
      status, openedAt: p.timestamp, technicianId: p.technician_id, description: p.fault_description, source: 'history',
    };
  });
}

// Fault-mode catalogue (for filters/labels) — pulled straight from the library.
export function faultCatalogue(): Array<{ type: EquipmentType; faultCode: string }> {
  const out: Array<{ type: EquipmentType; faultCode: string }> = [];
  for (const type of Object.keys(FAULT_LIBRARY) as EquipmentType[])
    for (const t of FAULT_LIBRARY[type]) out.push({ type, faultCode: t.faultCode });
  return out;
}
