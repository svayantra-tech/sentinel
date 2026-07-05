// ─────────────────────────────────────────────────────────────────────────────
// Sentinel — 15-year deployment history generator (2011-01 → 2025-12).
//
// A real plant that has run Sentinel since 2011 does not have 50 incidents; it
// has thousands, spread across a real fleet of many pumps/compressors/conveyors
// and five plants. This module manufactures that corpus DETERMINISTICALLY:
// a seeded mulberry32 PRNG (fixed seed 0x5E27) means the corpus is byte-identical
// on every rebuild — reproducible demos, clean diffs, no `Math.random()`.
//
// The story the data tells (and scripts/history-check.ts proves):
//   · bathtub failure rates (infant-mortality + wear-out),
//   · seasonality (summer thermal faults, monsoon belt tracking),
//   · ⭐ the institutional-memory FLYWHEEL — every repeat of a fault resolves
//     faster (MTTR decays per-occurrence toward an OEM floor) and recurs less
//     often after memory capture matured (~2014). Net: org-wide mean MTTR
//     slopes DOWN year over year and repeat-failures-per-asset decline.
//
// Emits genuine `IncidentPayload` records (the exact Qdrant shape) so a live
// fault today retrieves real neighbours from years past. A sibling `IncidentCost`
// record powers the ₹-saved story without polluting the vector payload.
// ─────────────────────────────────────────────────────────────────────────────
import type { EquipmentType, IncidentPayload } from '@/lib/types';

type Severity = 'critical' | 'high' | 'medium';
export type Tier = 'critical' | 'high' | 'standard';

// ── Deterministic PRNG (mulberry32, fixed seed) — NEVER Math.random() ────────
const SEED = 0x5e27;
// Fleet-wide incident intensity — tuned so the corpus lands at ~2,900 incidents
// (per-fault monthly probability stays well below 1, so no clipping).
const INTENSITY = 1.9;
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
function weighted<T>(rng: () => number, pairs: ReadonlyArray<readonly [T, number]>): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; }
  return pairs[pairs.length - 1][0];
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ── Plants (5) ───────────────────────────────────────────────────────────────
export interface Plant { id: string; name: string; region: string }
export const PLANTS: Plant[] = [
  { id: 'IN-02', name: 'Pune Process Works', region: 'West' },
  { id: 'IN-04', name: 'Chennai Cement & Utilities', region: 'South' },
  { id: 'IN-07', name: 'Vadodara Petrochem', region: 'West' },
  { id: 'IN-09', name: 'Rourkela Bulk Handling', region: 'East' },
  { id: 'IN-11', name: 'Bhiwadi Compressor House', region: 'North' },
];
const PLANT_IDS = PLANTS.map((p) => p.id);

// ── Equipment OEM identity (mirrors OEM_MANUALS manufacturers) ───────────────
const OEM: Record<EquipmentType, { manufacturer: string; model: string }> = {
  centrifugal_pump: { manufacturer: 'Grundfos', model: 'CR95' },
  compressor: { manufacturer: 'Atlas Copco', model: 'GA75' },
  conveyor: { manufacturer: 'Flexco/Siemens', model: 'BW-1400 / 1LE1' },
};

// ── Cost model — asset criticality tier drives downtime ₹/min ────────────────
const TIER_RATE_PER_MIN: Record<Tier, number> = { critical: 4500, high: 2800, standard: 1500 };
const LABOR_RATE_PER_HOUR = 650;

// ── Assets ───────────────────────────────────────────────────────────────────
export interface Asset {
  id: string;
  type: EquipmentType;
  plantId: string;
  manufacturer: string;
  model: string;
  installDate: string;   // ISO
  tier: Tier;
  baseAnnualFailureRate: number;
  hero: boolean;
}

// Hero + demo-referenced assets pinned so the live demo, BASE_INCIDENTS, and the
// fleet presets all agree on plant/tier. Everything else is generated.
const PINNED: Record<string, { plantId: string; tier: Tier; hero?: boolean; install?: string; rate?: number }> = {
  'PUMP-7': { plantId: 'IN-04', tier: 'critical', hero: true, install: '2010-03-01', rate: 5.4 },
  'COMP-2': { plantId: 'IN-04', tier: 'critical', hero: true, install: '2010-06-01', rate: 5.0 },
  'CONV-1': { plantId: 'IN-04', tier: 'high', hero: true, install: '2011-02-01', rate: 4.6 },
  'PUMP-2': { plantId: 'IN-04', tier: 'high', install: '2011-09-01', rate: 4.2 },
  'PUMP-3': { plantId: 'IN-02', tier: 'high', install: '2012-04-01', rate: 3.8 },
  'PUMP-11': { plantId: 'IN-07', tier: 'standard', install: '2013-01-01', rate: 3.2 },
  'COMP-5': { plantId: 'IN-02', tier: 'high', install: '2012-11-01', rate: 3.6 },
  'CONV-3': { plantId: 'IN-07', tier: 'standard', install: '2013-07-01', rate: 3.4 },
};

const TYPE_COUNTS: Array<[EquipmentType, string, number]> = [
  ['centrifugal_pump', 'PUMP', 28],
  ['compressor', 'COMP', 16],
  ['conveyor', 'CONV', 16],
];

function buildAssets(): Asset[] {
  const rng = mulberry32(SEED ^ 0xa11);
  const assets: Asset[] = [];
  for (const [type, prefix, count] of TYPE_COUNTS) {
    for (let n = 1; n <= count; n++) {
      const id = `${prefix}-${n}`;
      const pin = PINNED[id];
      const tier: Tier = pin?.tier ?? weighted<Tier>(rng, [['critical', 1], ['high', 2], ['standard', 3]]);
      const installYear = 2009 + Math.floor(rng() * 12); // 2009-2020 stagger
      const installMonth = 1 + Math.floor(rng() * 12);
      const install = pin?.install ?? `${installYear}-${String(installMonth).padStart(2, '0')}-01`;
      const rate = pin?.rate ?? +(2.4 + rng() * 3.4).toFixed(2); // 2.4-5.8 failures/yr
      assets.push({
        id, type, plantId: pin?.plantId ?? PLANT_IDS[Math.floor(rng() * PLANT_IDS.length)],
        manufacturer: OEM[type].manufacturer, model: OEM[type].model,
        installDate: install, tier, baseAnnualFailureRate: rate, hero: pin?.hero ?? false,
      });
    }
  }
  return assets;
}
export const ASSETS: Asset[] = buildAssets();
export const ASSET_BY_ID: Map<string, Asset> = new Map(ASSETS.map((a) => [a.id, a]));

// ── Technician roster (~18) — resolution counts/MTTR are DERIVED, not stored ─
export interface Technician {
  id: string; name: string; skill: 1 | 2 | 3; hireDate: string; plantId: string; specialization: string;
}
export const TECHNICIANS: Technician[] = [
  { id: 'T-1043', name: 'Ravi Kumar', skill: 1, hireDate: '2016-05-01', plantId: 'IN-04', specialization: 'Rotating equipment' },
  { id: 'T-0871', name: 'Priya Nair', skill: 2, hireDate: '2013-02-01', plantId: 'IN-04', specialization: 'Vibration & bearings' },
  { id: 'T-1101', name: 'Suresh Iyer', skill: 2, hireDate: '2014-08-01', plantId: 'IN-02', specialization: 'Mechanical seals' },
  { id: 'T-0417', name: 'Anita Rao', skill: 3, hireDate: '2011-06-01', plantId: 'IN-07', specialization: 'Gearboxes & drives' },
  { id: 'T-0644', name: 'Mohan Das', skill: 2, hireDate: '2012-09-01', plantId: 'IN-04', specialization: 'Compressors & thermal' },
  { id: 'T-0989', name: 'Fatima Sheikh', skill: 3, hireDate: '2012-01-01', plantId: 'IN-02', specialization: 'Electrical & motors' },
  { id: 'T-1150', name: 'Deepak Menon', skill: 1, hireDate: '2017-03-01', plantId: 'IN-04', specialization: 'Conveyors & belts' },
  { id: 'T-0322', name: 'Karthik Reddy', skill: 3, hireDate: '2011-04-01', plantId: 'IN-09', specialization: 'Bulk handling' },
  { id: 'T-0555', name: 'Neha Gupta', skill: 2, hireDate: '2015-07-01', plantId: 'IN-11', specialization: 'Air systems' },
  { id: 'T-0708', name: 'Arjun Pillai', skill: 2, hireDate: '2014-02-01', plantId: 'IN-07', specialization: 'Alignment & balancing' },
  { id: 'T-0910', name: 'Sunita Joshi', skill: 1, hireDate: '2018-01-01', plantId: 'IN-02', specialization: 'PM & lubrication' },
  { id: 'T-1204', name: 'Vikram Singh', skill: 3, hireDate: '2011-09-01', plantId: 'IN-04', specialization: 'Reliability engineering' },
  { id: 'T-1330', name: 'Meera Krishnan', skill: 2, hireDate: '2016-11-01', plantId: 'IN-09', specialization: 'Bearings & lubrication' },
  { id: 'T-1408', name: 'Rahul Verma', skill: 1, hireDate: '2019-04-01', plantId: 'IN-11', specialization: 'Field diagnostics' },
  { id: 'T-1512', name: 'Divya Menon', skill: 2, hireDate: '2015-03-01', plantId: 'IN-07', specialization: 'Separators & filtration' },
  { id: 'T-1618', name: 'Ganesh Patil', skill: 3, hireDate: '2012-05-01', plantId: 'IN-02', specialization: 'Compressor overhaul' },
  { id: 'T-1720', name: 'Lakshmi Rao', skill: 2, hireDate: '2017-08-01', plantId: 'IN-09', specialization: 'Idlers & tracking' },
  { id: 'T-1834', name: 'Imran Khan', skill: 1, hireDate: '2020-02-01', plantId: 'IN-11', specialization: 'Electrical terminations' },
];
const TECHS_BY_PLANT: Map<string, Technician[]> = (() => {
  const m = new Map<string, Technician[]>();
  for (const t of TECHNICIANS) { const a = m.get(t.plantId) ?? []; a.push(t); m.set(t.plantId, a); }
  return m;
})();

// ── Fault-mode library ───────────────────────────────────────────────────────
export interface FaultTemplate {
  faultCode: string;
  weight: number;                             // relative monthly probability
  severityMix: ReadonlyArray<readonly [Severity, number]>;
  descriptions: readonly string[];
  rootCauses: readonly string[];
  fixes: readonly string[];
  parts: readonly string[];
  mttrMin: number;                            // OEM-driven floor (minutes)
  mttrMax: number;                            // first-occurrence ceiling
  season?: 'summer' | 'monsoon';
}

export const FAULT_LIBRARY: Record<EquipmentType, FaultTemplate[]> = {
  centrifugal_pump: [
    {
      faultCode: 'VIB-201', weight: 22, mttrMin: 95, mttrMax: 230,
      severityMix: [['high', 5], ['medium', 3], ['critical', 1]],
      descriptions: [
        'High radial vibration 8.6 mm/s RMS on drive-end bearing, rising over 48 h, audible growl at 1x-3x RPM.',
        'DE bearing vibration 9.2 mm/s RMS trending up, BPFO harmonics dominant on spectrum.',
        'Bearing vibration alarm at 7.9 mm/s RMS, grease weeping dark from labyrinth seal.',
        'Repeat vibration alarm 8.1 mm/s DE bearing, envelope spectrum showing early race defect.',
      ],
      rootCauses: [
        'Drive-end bearing outer-race spalling from grease starvation (missed 4000 h relube).',
        'Bearing cap over-torqued in previous repair distorted the outer race (OEM limit 45 Nm).',
        'Rolling-element bearing BPFI defect after contamination ingress past a failed labyrinth.',
        'Under-lubrication of the NDE bearing accelerated by high ambient temperature.',
      ],
      fixes: [
        'Replaced DE bearing 6312-C3, relubed NDE, torqued bearing cap to 45 Nm cross-pattern, verified vibration 2.1 mm/s.',
        'Fitted new bearing with induction heater, torqued cap two-pass 25→45 Nm per manual 7.3, added torque-wrench sign-off.',
        'Replaced both bearings, corrected labyrinth clearance, set 15 g / 4000 h relube regime, vibration 2.4 mm/s.',
        'Swapped DE bearing, verified alignment, logged baseline spectrum for trend tracking.',
      ],
      parts: ['SKF 6312-C3 bearing', 'labyrinth seal kit', 'SF-2 lithium grease'],
    },
    {
      faultCode: 'VIB-118', weight: 10, mttrMin: 110, mttrMax: 250,
      severityMix: [['medium', 5], ['high', 2]],
      descriptions: [
        'Vibration 7.6 mm/s dominant at 1x RPM after impeller service, phase readings unstable.',
        'Rising 1x vibration post-overhaul, suspected residual rotor imbalance.',
        'Broadband 1x growth to 7.4 mm/s, coupling checked square.',
      ],
      rootCauses: [
        'Impeller imbalance — trim weld performed without re-balancing.',
        'Residual unbalance after impeller replacement, rotor never field-balanced.',
        'Product build-up on one impeller vane shifting the mass centre.',
      ],
      fixes: [
        'Field-balanced rotor to G2.5, verified 1.9 mm/s. Added balancing to impeller-service checklist.',
        'Cleaned impeller, re-balanced in place to G2.5, confirmed 2.0 mm/s.',
        'Two-plane field balance, residual 1.8 mm/s, updated PM to include post-service balance.',
      ],
      parts: ['balancing weights', 'impeller o-ring'],
    },
    {
      faultCode: 'SEAL-044', weight: 13, mttrMin: 120, mttrMax: 240,
      severityMix: [['high', 4], ['medium', 3], ['critical', 1]],
      descriptions: [
        'Mechanical seal weep 20 drops/min escalating to spray; product visible on baseplate.',
        'Seal chamber leak steady, flush line temperature elevated.',
        'Cartridge seal weeping after dry-run event, faces suspected glazed.',
      ],
      rootCauses: [
        'Dry-run event during suction strainer blockage burned seal faces.',
        'Seal faces glazed from loss of flush flow (plugged API plan 11 orifice).',
        'Shaft sleeve scoring under the secondary seal drove the leak path.',
      ],
      fixes: [
        'Replaced cartridge seal, cleared strainer, added low-suction-pressure interlock test to PM.',
        'Fitted new cartridge seal, cleared flush orifice, leak-tested 15 min at operating pressure.',
        'Replaced seal and shaft sleeve, set spring compression per seal card, no weep on restart.',
      ],
      parts: ['cartridge mechanical seal', 'shaft sleeve', 'flush orifice'],
    },
    {
      faultCode: 'TEMP-090', weight: 12, mttrMin: 60, mttrMax: 160, season: 'summer',
      severityMix: [['medium', 5], ['high', 3]],
      descriptions: [
        'DE bearing temperature 96 °C alarm (limit 85 °C), grease purging dark from labyrinth.',
        'Bearing running 92 °C in afternoon heat, ambient 44 °C.',
        'Over-temperature trip on NDE bearing, grease churned and darkened.',
      ],
      rootCauses: [
        'Over-greasing churned bearing; thermal runaway.',
        'High ambient plus degraded grease pushed bearing past 85 °C.',
        'Blocked cooling-fin path around the bearing housing.',
      ],
      fixes: [
        'Purged excess grease, set 15 g/4000 h regime per OEM, temp stabilised 61 °C.',
        'Re-greased with SF-2 to spec quantity, cleaned housing fins, temp 64 °C.',
        'Corrected relube volume, added summer temperature trend alarm, stable 62 °C.',
      ],
      parts: ['SF-2 lithium grease'],
    },
    {
      faultCode: 'CAV-013', weight: 9, mttrMin: 55, mttrMax: 140,
      severityMix: [['medium', 6], ['high', 1]],
      descriptions: [
        'Gravel-like noise, fluctuating discharge pressure, vibration broadband high frequency.',
        'Cavitation crackle at low tank level, discharge pressure hunting.',
        'Suction-side noise and impeller erosion suspected after filter fouling.',
      ],
      rootCauses: [
        'Cavitation — NPSH margin lost after upstream filter fouled.',
        'Suction strainer partially blocked, NPSH available dropped below required.',
        'Tank level setpoint too low, vortexing air into suction.',
      ],
      fixes: [
        'Cleaned filter, raised tank min level setpoint, throttled discharge to curve. Noise cleared.',
        'Cleared strainer, restored NPSH margin, verified stable discharge pressure.',
        'Raised min-level interlock, cleaned suction line, cavitation eliminated.',
      ],
      parts: ['suction strainer element'],
    },
    {
      faultCode: 'MIS-160', weight: 8, mttrMin: 90, mttrMax: 200,
      severityMix: [['medium', 4], ['high', 3]],
      descriptions: [
        'Coupling running hot, 2x RPM vibration component elevated, elastomer element cracking.',
        'Recurring coupling wear, misalignment suspected after baseplate grouting settled.',
        'Axial vibration rise at 2x, shims disturbed by thermal growth.',
      ],
      rootCauses: [
        'Shaft misalignment 0.4 mm from settled baseplate grout.',
        'Soft-foot condition left uncorrected after motor swap.',
        'Thermal growth not compensated in cold alignment.',
      ],
      fixes: [
        'Laser-aligned to 0.05 mm, corrected soft-foot, replaced coupling element, 2x vibration cleared.',
        'Re-shimmed and laser-aligned with thermal-growth targets, verified 1.9 mm/s.',
        'Corrected soft-foot, re-grouted baseplate, aligned to spec.',
      ],
      parts: ['coupling element', 'alignment shims'],
    },
    {
      faultCode: 'NPSH-022', weight: 6, mttrMin: 70, mttrMax: 150,
      severityMix: [['medium', 5], ['high', 1]],
      descriptions: [
        'Repeated low-flow trips, suction gauge swinging, priming lost intermittently.',
        'Air ingress on suction, pump losing prime after each stop.',
        'Suction pressure below required NPSH during peak demand.',
      ],
      rootCauses: [
        'Air ingress past a weeping suction-flange gasket.',
        'Foot valve leaking, losing prime on shutdown.',
        'Undersized suction line at peak flow starving the pump.',
      ],
      fixes: [
        'Replaced suction gasket, bled air, verified stable prime and flow.',
        'Rebuilt foot valve, primed system, added prime-check to startup SOP.',
        'Cleared partial blockage, restored NPSH margin, trips cleared.',
      ],
      parts: ['suction flange gasket', 'foot valve kit'],
    },
  ],
  compressor: [
    {
      faultCode: 'HT-310', weight: 20, mttrMin: 75, mttrMax: 210, season: 'summer',
      severityMix: [['high', 4], ['medium', 3], ['critical', 1]],
      descriptions: [
        'GA75 tripping on discharge temperature 112 °C within 20 min of load, ambient 38 °C.',
        'High discharge temperature trip, oil-cooler fins visibly fouled.',
        'Discharge temperature climbing to 110 °C setpoint in afternoon heat.',
      ],
      rootCauses: [
        'Oil cooler fins packed with cotton lint; thermostatic valve sluggish.',
        'Fouled oil cooler and low oil level combined to raise discharge temperature.',
        'Thermostatic bypass valve stuck, oil not routed through cooler.',
      ],
      fixes: [
        'Blew coolers inside-out at 6 bar, replaced thermostatic element, trip cleared, running 87 °C.',
        'Cleaned cooler core, topped Roto-Inject oil, verified discharge 89 °C loaded.',
        'Replaced thermostatic valve, cleaned fins, added summer cooler-cleaning PM.',
      ],
      parts: ['thermostatic valve element', 'Roto-Inject Fluid', 'oil filter'],
    },
    {
      faultCode: 'OIL-207', weight: 12, mttrMin: 110, mttrMax: 230,
      severityMix: [['medium', 5], ['high', 2]],
      descriptions: [
        'Oil carry-over into air net, separator ΔP 1.2 bar, oil top-ups doubling.',
        'Excessive oil consumption, downstream filters oil-logged.',
        'Separator differential high, oil mist visible at receiver drain.',
      ],
      rootCauses: [
        'Separator element beyond life; scavenge line orifice blocked.',
        'Blocked scavenge return flooding the separator sump.',
        'Separator element ruptured under high differential.',
      ],
      fixes: [
        'Replaced separator element, cleared scavenge orifice, ΔP 0.25 bar, carry-over normal.',
        'Fitted new separator, cleaned scavenge line, verified oil consumption normal.',
        'Replaced element and scavenge check valve, ΔP restored to 0.3 bar.',
      ],
      parts: ['separator element', 'scavenge orifice', 'Roto-Inject Fluid'],
    },
    {
      faultCode: 'ELE-402', weight: 11, mttrMin: 70, mttrMax: 180,
      severityMix: [['high', 3], ['critical', 3], ['medium', 2]],
      descriptions: [
        'Main motor tripping on overload at 92 % load, currents unbalanced 7 %.',
        'Motor overload relay tripping intermittently under load.',
        'Phase-current imbalance with heat discolouration in the terminal box.',
      ],
      rootCauses: [
        'Loose T2 lug in motor terminal box heating under load.',
        'Overload relay set below FLA after a parts swap.',
        'Winding insulation degradation raising phase imbalance.',
      ],
      fixes: [
        'Isolated, re-terminated and torqued lugs to spec, thermographed under load — balanced.',
        'Corrected overload setting to nameplate FLA, verified balanced currents.',
        'Meggered windings, re-terminated, scheduled motor-shop inspection, imbalance 2 %.',
      ],
      parts: ['motor terminal lugs', 'overload relay'],
    },
    {
      faultCode: 'SEP-118', weight: 8, mttrMin: 90, mttrMax: 190,
      severityMix: [['medium', 5], ['high', 2]],
      descriptions: [
        'Separator tank pressure not bleeding down on stop, MPV suspected.',
        'Minimum-pressure valve holding excess pressure after shutdown.',
        'Air quality degrading, separator drain passing oil.',
      ],
      rootCauses: [
        'Minimum-pressure valve seat worn, not sealing on shutdown.',
        'Separator drain solenoid clogged with sludge.',
        'MPV spring fatigued, cracking pressure drifted.',
      ],
      fixes: [
        'Rebuilt minimum-pressure valve, verified bleed-down to 0 bar on stop.',
        'Cleaned drain solenoid, replaced MPV seat, air quality restored.',
        'Replaced MPV cartridge, confirmed correct cracking pressure.',
      ],
      parts: ['minimum-pressure valve kit', 'drain solenoid'],
    },
    {
      faultCode: 'VLV-076', weight: 7, mttrMin: 80, mttrMax: 170,
      severityMix: [['medium', 5], ['high', 1]],
      descriptions: [
        'Intake regulator hunting, load/unload cycling rapidly.',
        'Unloader valve leaking, compressor short-cycling.',
        'Blow-down valve not venting fully on unload.',
      ],
      rootCauses: [
        'Intake unloader diaphragm perished, causing cycling.',
        'Blow-down valve orifice sludged, slow to vent.',
        'Regulator setpoint drifted, load band too narrow.',
      ],
      fixes: [
        'Rebuilt unloader with new diaphragm, tuned load band, cycling stopped.',
        'Cleaned blow-down valve, verified full vent, stable load/unload.',
        'Reset regulator band, replaced diaphragm kit, normal cycling.',
      ],
      parts: ['unloader diaphragm kit', 'regulator o-rings'],
    },
    {
      faultCode: 'AIR-051', weight: 6, mttrMin: 45, mttrMax: 120,
      severityMix: [['medium', 6], ['high', 1]],
      descriptions: [
        'Air-net pressure drop overnight, ultrasonic leak survey pending.',
        'Compressor running longer to hold setpoint, leak suspected downstream.',
        'Audible hiss at pipe union, pressure decay 1.5 bar/hour off-load.',
      ],
      rootCauses: [
        'Leaking pipe union and a failed quick-coupler downstream.',
        'Perished hose on a point-of-use drop leaking continuously.',
        'Condensate drain stuck open venting air.',
      ],
      fixes: [
        'Ultrasonic survey, tightened unions, replaced quick-coupler, decay eliminated.',
        'Replaced perished hose, verified zero decay off-load.',
        'Rebuilt condensate drain, confirmed leak-tight air net.',
      ],
      parts: ['quick-coupler', 'air hose', 'condensate drain kit'],
    },
  ],
  conveyor: [
    {
      faultCode: 'TRK-155', weight: 18, mttrMin: 70, mttrMax: 180, season: 'monsoon',
      severityMix: [['medium', 6], ['high', 2]],
      descriptions: [
        'Belt drifting hard left at tail, edge fraying, spillage building on return side.',
        'Belt mistracking after monsoon rain, off-centre at head pulley.',
        'Persistent belt wander, edge contact with structure, spillage increasing.',
      ],
      rootCauses: [
        'Seized troughing idler 40 m from tail dragging the belt off-centre.',
        'Off-centre loading at the chute after skirt wear.',
        'Snub pulley material build-up steering the belt.',
      ],
      fixes: [
        'LOTO with counterweight pinned, replaced two seized idlers, tracked belt over 2 revolutions.',
        'Cleaned snub pulley, adjusted training idlers 3 mm/pass, belt centred.',
        'Realigned chute skirts, replaced idlers, tracking stable over 2 revolutions.',
      ],
      parts: ['troughing idler', 'training idler', 'skirt rubber'],
    },
    {
      faultCode: 'SPL-071', weight: 11, mttrMin: 150, mttrMax: 300, season: 'monsoon',
      severityMix: [['high', 4], ['medium', 3], ['critical', 1]],
      descriptions: [
        'Clicking at splice each revolution, mechanical fasteners lifting on one edge.',
        'Splice separating at the edge, fasteners pulling through in wet conditions.',
        'Belt splice failing under load, visible gap opening each pass.',
      ],
      rootCauses: [
        'Splice installed 4 mm out of square; edge stress concentrating on fasteners.',
        'Fastener corrosion during monsoon weakened the splice.',
        'Under-tensioned belt let the splice flex and fatigue.',
      ],
      fixes: [
        'Cut and re-spliced square with counterweight pinned, retensioned to 1.2 % elongation.',
        'Installed new vulcanised splice, retensioned belt, verified over 2 revolutions.',
        'Re-spliced square, replaced corroded fasteners, set correct tension.',
      ],
      parts: ['splice kit', 'mechanical fasteners', 'belt clamp'],
    },
    {
      faultCode: 'GBX-233', weight: 9, mttrMin: 60, mttrMax: 260,
      severityMix: [['high', 4], ['critical', 2], ['medium', 1]],
      descriptions: [
        'Drive gearbox whining under load, oil sample dark with fine brass glitter.',
        'Gearbox running hot, oil analysis flags wear metals rising.',
        'Backlash increasing at drive, gearbox noise on start.',
      ],
      rootCauses: [
        'Bronze worm-wheel wear from 800 h overdue oil change (CLP 220 degraded).',
        'Gearbox oil contaminated with water during monsoon, accelerating wear.',
        'Input-shaft bearing failing, feeding metal into the oil.',
      ],
      fixes: [
        'Escalated: gearbox swap scheduled; interim oil change and load cap 70 %.',
        'Replaced gearbox oil CLP 220, sampled trend, scheduled overhaul.',
        'Swapped gearbox with rebuilt unit, aligned drive, verified temperature normal.',
      ],
      parts: ['gearbox CLP 220 oil', 'input-shaft bearing', 'rebuilt gearbox'],
    },
    {
      faultCode: 'IDL-090', weight: 10, mttrMin: 40, mttrMax: 120,
      severityMix: [['medium', 6], ['high', 1]],
      descriptions: [
        'Multiple return idlers seized, belt bottom cover scoring, drag rising.',
        'Idler bearing failure causing flat spots and noise on return run.',
        'Frozen carrying idler creating a hot rub mark on the belt.',
      ],
      rootCauses: [
        'Return idler bearings seized from ingress and no relube.',
        'Idler shells worn flat, dragging and heating the belt.',
        'Carrying idler bearing collapsed under fines contamination.',
      ],
      fixes: [
        'Replaced six seized idlers, cleaned frames, drag current dropped to normal.',
        'Swapped worn idlers, added idler-rotation check to weekly PM.',
        'Replaced carrying idler set, verified free rotation across the span.',
      ],
      parts: ['return idler', 'carrying idler set'],
    },
    {
      faultCode: 'BLT-140', weight: 8, mttrMin: 90, mttrMax: 280,
      severityMix: [['medium', 5], ['high', 3]],
      descriptions: [
        'Top cover wear exposing carcass over a 30 m section, cuts from tramp metal.',
        'Belt cover cracking and thinning at load zone, carcass showing.',
        'Longitudinal gouge from a trapped bolt, cover integrity compromised.',
      ],
      rootCauses: [
        'Impact damage at the load zone from oversized feed and worn impact bars.',
        'Cover degradation from heat and abrasion beyond rated life.',
        'Tramp metal gouged the belt after the magnet failed.',
      ],
      fixes: [
        'Hot-vulcanised patch repair over 30 m, replaced impact bars, added feed screen.',
        'Cold-patched cuts, scheduled belt replacement, restored magnet protection.',
        'Vulcanised repair, corrected loading, cover integrity restored.',
      ],
      parts: ['vulcanising patch', 'impact bars', 'belt cleaner blade'],
    },
    {
      faultCode: 'MOT-210', weight: 7, mttrMin: 70, mttrMax: 190,
      severityMix: [['high', 3], ['critical', 2], ['medium', 3]],
      descriptions: [
        'Drive motor tripping on start, insulation resistance dropping.',
        'Drive motor overheating under load, winding temperature high.',
        'Motor bearing noise and current spikes on the conveyor drive.',
      ],
      rootCauses: [
        'Drive-motor winding insulation degraded by moisture ingress.',
        'Motor cooling fan cowl blocked with fines, overheating windings.',
        'Motor DE bearing failure loading the drive.',
      ],
      fixes: [
        'Dried and re-varnished windings, restored insulation resistance, motor returned to service.',
        'Cleaned cowl and fins, verified winding temperature normal under load.',
        'Replaced motor bearings, aligned drive, current and noise normal.',
      ],
      parts: ['motor bearing set', 'winding varnish', 'cooling fan cowl'],
    },
  ],
};

// ── Incident + cost records ──────────────────────────────────────────────────
export interface IncidentCost {
  downtimeMinutes: number;
  downtimeCostINR: number;
  partsCostINR: number;
  laborHours: number;
  laborCostINR: number;
}
export interface HistoryIncident {
  id: string;
  payload: IncidentPayload;
  cost: IncidentCost;
}
export interface History {
  assets: Asset[];
  technicians: Technician[];
  incidents: HistoryIncident[];
}

function bathtub(ageYears: number): number {
  if (ageYears < 1.5) return 1.55 - 0.2 * ageYears;      // infant mortality tapering
  if (ageYears > 11) return 0.9 + 0.09 * (ageYears - 11); // wear-out ramp
  return 0.85;                                            // useful-life floor
}

function pickTech(rng: () => number, plantId: string, severity: Severity): string {
  const pool = TECHS_BY_PLANT.get(plantId) ?? TECHNICIANS;
  // Bias critical/high work toward higher-skill techs, but keep the roster active.
  const minSkill = severity === 'critical' ? 3 : severity === 'high' ? 2 : 1;
  const eligible = pool.filter((t) => t.skill >= minSkill);
  const chosen = (eligible.length ? eligible : pool);
  return pick(rng, chosen).id;
}

// ── The generator — memoized (deterministic → cache once) ────────────────────
let _history: History | null = null;
export function generateHistory(): History {
  if (_history) return _history;
  const rng = mulberry32(SEED);
  const incidents: HistoryIncident[] = [];
  let seq = 0;

  for (const asset of ASSETS) {
    const lib = FAULT_LIBRARY[asset.type];
    const weightTotal = lib.reduce((s, t) => s + t.weight, 0);
    const installMs = Date.parse(asset.installDate);
    const occ = new Map<string, number>(); // asset+faultCode → prior occurrences

    for (let m = 0; m < 180; m++) {
      const year = 2011 + Math.floor(m / 12);
      const monthNum = (m % 12) + 1;                  // 1..12
      const monthStartMs = Date.UTC(year, monthNum - 1, 1);
      if (monthStartMs < installMs) continue;
      const ageYears = (monthStartMs - installMs) / (365.25 * 24 * 3600 * 1000);
      const monthlyBase = (asset.baseAnnualFailureRate / 12) * bathtub(ageYears) * INTENSITY;

      for (const tmpl of lib) {
        let p = monthlyBase * (tmpl.weight / weightTotal);
        if (tmpl.season === 'summer' && monthNum >= 4 && monthNum <= 6) p *= 1.6;
        if (tmpl.season === 'monsoon' && monthNum >= 7 && monthNum <= 9) p *= 1.5;
        const priorOcc = occ.get(tmpl.faultCode) ?? 0;
        // ⭐ Flywheel: recurrences get rarer once memory capture matured (~2014).
        if (priorOcc > 0) p *= year >= 2014 ? 0.42 : 0.85;
        if (rng() >= p) continue;

        const severity = weighted<Severity>(rng, tmpl.severityMix);
        const escalated = rng() < 0.08;
        // ⭐ Flywheel: per-occurrence MTTR decay + calendar-wide improvement,
        // floored at the OEM-driven minimum. Guarantees a downward yearly trend.
        const decay = Math.pow(0.92, Math.min(priorOcc, 8));
        const calendar = clamp(1 - 0.032 * (year - 2011), 0.5, 1);
        let mttr = tmpl.mttrMax * decay * calendar;
        mttr += (rng() * 2 - 1) * tmpl.mttrMin * 0.15;
        mttr = Math.round(clamp(mttr, tmpl.mttrMin * 0.8, tmpl.mttrMax * 1.2));

        const day = 1 + Math.floor(rng() * 27);
        const hour = Math.floor(rng() * 24);
        const minute = Math.floor(rng() * 4) * 15;
        const ts = new Date(Date.UTC(year, monthNum - 1, day, hour, minute)).toISOString();

        const payload: IncidentPayload = {
          kind: 'incident',
          equipment_id: asset.id,
          equipment_type: asset.type,
          plant_id: asset.plantId,
          fault_code: tmpl.faultCode,
          fault_description: pick(rng, tmpl.descriptions),
          root_cause: pick(rng, tmpl.rootCauses),
          fix_applied: pick(rng, tmpl.fixes),
          time_to_resolve_minutes: mttr,
          severity,
          outcome: escalated ? 'escalated' : 'resolved',
          technician_id: pickTech(rng, asset.plantId, severity),
          timestamp: ts,
        };
        incidents.push({
          id: `INC-${String(++seq).padStart(6, '0')}`,
          payload,
          // Cost is a deterministic function of the (Qdrant-stored) payload —
          // so /analytics numbers are identical whether aggregated from the
          // array or scrolled straight out of Qdrant.
          cost: makeCost(asset.id, mttr, severity, escalated),
        });
        occ.set(tmpl.faultCode, priorOcc + 1);
      }
    }
  }

  _history = { assets: ASSETS, technicians: TECHNICIANS, incidents };
  return _history;
}

// Tier lookup used when wrapping the hand-authored base incidents with a cost.
export function tierOf(equipmentId: string): Tier {
  return ASSET_BY_ID.get(equipmentId)?.tier ?? 'high';
}
export function makeCost(equipmentId: string, mttr: number, severity: Severity, escalated: boolean): IncidentCost {
  // Deterministic (no rng needed) proxy cost for the 12 hand-authored incidents.
  const tier = tierOf(equipmentId);
  const downtimeFactor = escalated ? 2.6 : severity === 'critical' ? 1.7 : severity === 'high' ? 1.3 : 1.0;
  const downtimeMinutes = Math.round(mttr * downtimeFactor);
  return {
    downtimeMinutes,
    downtimeCostINR: Math.round(downtimeMinutes * TIER_RATE_PER_MIN[tier]),
    partsCostINR: severity === 'critical' ? 14000 : severity === 'high' ? 8200 : 4200,
    laborHours: Math.round((mttr / 60) * 4) / 4,
    laborCostINR: Math.round((mttr / 60) * LABOR_RATE_PER_HOUR),
  };
}
