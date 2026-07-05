// ─────────────────────────────────────────────────────────────────────────────
// Sentinel seed corpus (FR-14 / PRD §18)
// 12 hand-authored high-fidelity incidents → expanded to 50 with plant/serial
// variation; OEM manual chunks (the hallucination ground truth lives here);
// vetted runbook library with skill-level gating.
// Public dataset lineage: fault modes mirror AI4I-2020 failure classes
// (heat dissipation, power, overstrain, tool wear) and NASA C-MAPSS degradation.
// ─────────────────────────────────────────────────────────────────────────────
import type { IncidentPayload, ManualPayload, RunbookPayload } from '@/lib/types';
import { generateHistory, makeCost, type HistoryIncident } from './history';

// ── OEM manual chunks — the "technical truth" Enkrypt cross-checks against ───
// The first chunk (Grundfos 45 Nm bearing-cap torque) is the live safety-demo
// ground truth and is preserved verbatim — never edit it.
const BASE_OEM_MANUALS: ManualPayload[] = [
  {
    kind: 'manual', equipment_type: 'centrifugal_pump', manufacturer: 'Grundfos',
    section_type: 'torque_specs', chapter: '7.3 Bearing Assembly', page_range: '112-114',
    text:
      'Bearing cap bolts (CR95 frame): torque to 45 Nm in a cross pattern, two passes ' +
      '(25 Nm then 45 Nm). Drive-end bearing locknut: 80 Nm using hook spanner HN-12. ' +
      'Impeller nut: 60 Nm with thread-locking compound grade 243. Never exceed rated ' +
      'torque on the bearing cap — over-torque distorts the outer race and causes ' +
      'premature spalling within 400-600 run hours.',
  },
  {
    kind: 'manual', equipment_type: 'centrifugal_pump', manufacturer: 'Grundfos',
    section_type: 'lockout_tagout', chapter: '2.1 Isolation Procedure', page_range: '18-21',
    text:
      'Before ANY intrusive work: (1) stop pump from local control station, (2) isolate ' +
      'and lock the motor breaker at the MCC, apply personal danger tag, (3) close and ' +
      'lock suction and discharge valves, (4) vent casing pressure via drain valve until ' +
      'gauge reads zero, (5) verify zero energy with a test start attempt. Casing may ' +
      'retain pressure after shutdown — never crack a flange before venting.',
  },
  {
    kind: 'manual', equipment_type: 'centrifugal_pump', manufacturer: 'Grundfos',
    section_type: 'maintenance', chapter: '7.1 Vibration Diagnostics', page_range: '98-104',
    text:
      'Radial vibration above 7.1 mm/s RMS (ISO 10816 zone D) indicates bearing damage, ' +
      'misalignment, or impeller imbalance. Dominant frequency at 1x RPM suggests ' +
      'imbalance; at BPFO/BPFI harmonics suggests rolling-element bearing defects. ' +
      'Bearing operating temperature must not exceed 85 °C; grease with Grundfos SF-2 ' +
      'lithium complex, 15 g per bearing at 4000-hour intervals.',
  },
  {
    kind: 'manual', equipment_type: 'centrifugal_pump', manufacturer: 'Grundfos',
    section_type: 'safety', chapter: '1.4 PPE & Hot Surfaces', page_range: '9-10',
    text:
      'Mandatory PPE for pump maintenance: safety glasses, cut-resistant gloves, safety ' +
      'boots, hearing protection above 85 dB(A). Volute surfaces can exceed 70 °C during ' +
      'operation — allow 30 minutes cooldown or wear heat-resistant gloves. Never disable ' +
      'the coupling guard interlock; the shaft can windmill from back-flow.',
  },
  {
    kind: 'manual', equipment_type: 'compressor', manufacturer: 'Atlas Copco',
    section_type: 'maintenance', chapter: '5.2 Thermal Protection', page_range: '61-66',
    text:
      'GA75 discharge temperature trip: 110 °C (do not raise the setpoint). High discharge ' +
      'temperature causes: fouled oil cooler, low oil level, ambient above 46 °C, failed ' +
      'thermostatic valve. Oil: Roto-Inject Fluid, 52 litres, change at 4000 h. Cooler ' +
      'fins: blow through with dry air at max 6 bar from inside out.',
  },
  {
    kind: 'manual', equipment_type: 'compressor', manufacturer: 'Atlas Copco',
    section_type: 'lockout_tagout', chapter: '2.3 Pressure Isolation', page_range: '24-27',
    text:
      'Before opening any pressurised section: stop unit, isolate electrical supply and ' +
      'lock, close air-net isolation valve, open manual condensate drain and vent the ' +
      'receiver to 0 bar on the gauge, wait 3 minutes for internal vessels to equalise. ' +
      'The minimum-pressure valve holds 4-6 bar in the separator tank after shutdown.',
  },
  {
    kind: 'manual', equipment_type: 'conveyor', manufacturer: 'Flexco/Siemens',
    section_type: 'maintenance', chapter: '4.5 Belt Tracking & Tension', page_range: '44-49',
    text:
      'Belt mistracking causes: seized troughing idler, off-centre loading, splice not ' +
      'square, snub pulley buildup. Correct tracking with snub/training idlers in 3 mm ' +
      'adjustments, run 2 full belt revolutions between adjustments. Belt tension: 1.2 % ' +
      'elongation for fabric belts. Drive motor (Siemens 1LE1): gearbox oil CLP 220, ' +
      '1.8 litres, check at 2000 h.',
  },
  {
    kind: 'manual', equipment_type: 'conveyor', manufacturer: 'Flexco/Siemens',
    section_type: 'lockout_tagout', chapter: '2.2 Zero-Energy Verification', page_range: '15-17',
    text:
      'Conveyor LOTO: stop from control room, lock local isolator, lock the gravity ' +
      'take-up winch (stored mechanical energy), pin the counterweight, test-start from ' +
      'both control room and local station. Never work on a belt with an unpinned ' +
      'counterweight — belt tension releases violently when a splice is cut.',
  },
];

// ── Extra OEM depth (PART A6) — more torque/LOTO/thermal/electrical sections so
// retrieval and the safety gate have real depth over the larger fleet. ───────
const EXTRA_MANUALS: ManualPayload[] = [
  {
    kind: 'manual', equipment_type: 'centrifugal_pump', manufacturer: 'Grundfos',
    section_type: 'torque_specs', chapter: '7.4 Casing & Coupling Fasteners', page_range: '115-118',
    text:
      'Casing bolts (CR95): torque to 70 Nm in a star pattern, two passes (40 Nm then 70 Nm). ' +
      'Coupling hub grub screws: 12 Nm. Baseplate hold-down bolts: 95 Nm. Suction/discharge ' +
      'flange bolts: 55 Nm with new gaskets. Always torque cold and re-check after first thermal ' +
      'cycle; never reuse spring washers on the bearing housing.',
  },
  {
    kind: 'manual', equipment_type: 'centrifugal_pump', manufacturer: 'Grundfos',
    section_type: 'maintenance', chapter: '7.5 Alignment & Balance', page_range: '119-124',
    text:
      'Cold alignment targets: 0.05 mm parallel and angular offset; set thermal-growth offset ' +
      'per the pumped-fluid temperature chart. Field-balance rotors to ISO 1940 G2.5. Soft-foot ' +
      'must be below 0.05 mm before alignment. Coupling elements: replace at 30 % elongation.',
  },
  {
    kind: 'manual', equipment_type: 'centrifugal_pump', manufacturer: 'Grundfos',
    section_type: 'safety', chapter: '1.5 Confined Sump & Chemical PPE', page_range: '11-13',
    text:
      'For pumps in a sump or handling process chemicals: gas-test before entry, wear chemical ' +
      'apron and face shield, and neutralise/flush the casing before opening. Product may be ' +
      'trapped in the seal chamber under pressure even after casing venting.',
  },
  {
    kind: 'manual', equipment_type: 'centrifugal_pump', manufacturer: 'Grundfos',
    section_type: 'maintenance', chapter: '7.6 Lubrication Schedule', page_range: '125-127',
    text:
      'Grease both bearings with SF-2 lithium complex, 15 g per bearing at 4000-hour intervals. ' +
      'Do not mix grease types. Over-greasing churns the bearing and drives temperature above ' +
      '85 °C — purge old grease via the relief plug during relube.',
  },
  {
    kind: 'manual', equipment_type: 'compressor', manufacturer: 'Atlas Copco',
    section_type: 'torque_specs', chapter: '5.4 Airend & Motor Fasteners', page_range: '67-70',
    text:
      'GA75 airend mounting bolts: 85 Nm. Motor-to-airend coupling bolts: 45 Nm. Separator-tank ' +
      'cover bolts: 60 Nm in a cross pattern with a new gasket. Oil-drain plug: 35 Nm. Electrical ' +
      'terminal lugs: torque to 12-14 Nm and thermograph under load after any re-termination.',
  },
  {
    kind: 'manual', equipment_type: 'compressor', manufacturer: 'Atlas Copco',
    section_type: 'safety', chapter: '1.7 Hot Surface & Rotating Parts', page_range: '14-16',
    text:
      'Airend discharge pipework exceeds 100 °C in operation — allow 30 minutes cooldown or use ' +
      'heat-resistant gloves. Never defeat the canopy interlock; the drive coupling is exposed. ' +
      'Hearing protection is mandatory inside the compressor house above 85 dB(A).',
  },
  {
    kind: 'manual', equipment_type: 'compressor', manufacturer: 'Atlas Copco',
    section_type: 'maintenance', chapter: '5.5 Separator & Oil System', page_range: '71-75',
    text:
      'Separator element life: 4000 h or ΔP above 0.8 bar, whichever first. Scavenge line orifice ' +
      'must be clear — a blocked scavenge floods the separator and causes oil carry-over. ' +
      'Minimum-pressure valve holds 4-6 bar in the tank after shutdown; verify bleed-down before work.',
  },
  {
    kind: 'manual', equipment_type: 'compressor', manufacturer: 'Atlas Copco',
    section_type: 'maintenance', chapter: '5.6 Electrical Protection', page_range: '76-79',
    text:
      'Set the overload relay to the motor nameplate FLA — never higher. Phase-current imbalance ' +
      'above 5 % indicates a loose termination or winding fault; megger phase-earth and phase-phase, ' +
      'record and trend. Discharge-temperature trip is fixed at 110 °C — do not raise the setpoint.',
  },
  {
    kind: 'manual', equipment_type: 'conveyor', manufacturer: 'Flexco/Siemens',
    section_type: 'torque_specs', chapter: '4.7 Pulley & Gearbox Fasteners', page_range: '50-53',
    text:
      'Drive-pulley locking-assembly bolts: 195 Nm in sequence, checked in two passes. Gearbox ' +
      'mounting bolts: 120 Nm. Idler-frame bolts: 45 Nm. Coupling guard fasteners: 25 Nm. Re-torque ' +
      'the locking assembly after the first 50 running hours.',
  },
  {
    kind: 'manual', equipment_type: 'conveyor', manufacturer: 'Flexco/Siemens',
    section_type: 'maintenance', chapter: '4.8 Gearbox & Drive-Motor Service', page_range: '54-58',
    text:
      'Gearbox oil: CLP 220, 1.8 litres, change at 2000 h or on wear-metal trend. Drive motor ' +
      '(Siemens 1LE1): insulation resistance min 1 MΩ, clean cooling cowl of fines each PM. Water ' +
      'ingress during monsoon accelerates bronze worm-wheel wear — sample oil monthly in the wet season.',
  },
  {
    kind: 'manual', equipment_type: 'conveyor', manufacturer: 'Flexco/Siemens',
    section_type: 'safety', chapter: '1.9 Stored Energy & Nip Points', page_range: '17-19',
    text:
      'The gravity take-up stores significant mechanical energy — always lock the take-up winch and ' +
      'pin the counterweight before belt work. Guard every nip point at pulleys and idlers. Never ' +
      'clear spillage or adjust a scraper while the belt is moving.',
  },
  {
    kind: 'manual', equipment_type: 'conveyor', manufacturer: 'Flexco/Siemens',
    section_type: 'maintenance', chapter: '4.9 Belt Repair & Splicing', page_range: '59-63',
    text:
      'Splices must be cut square within 1 mm; mechanical fasteners re-tension after 8 running hours. ' +
      'Vulcanised splices are preferred for wet or high-tension duty. Belt tension: 1.2 % elongation ' +
      'for fabric belts. Repair cover damage before the carcass is exposed to prevent moisture wicking.',
  },
];

// Full OEM corpus — base ground-truth chunks first, then the added depth.
export const OEM_MANUALS: ManualPayload[] = [...BASE_OEM_MANUALS, ...EXTRA_MANUALS];

// ── 12 hand-authored, high-fidelity incidents — the semantic anchors that make
// the live PUMP-7 vibration demo retrieve the exact right neighbours. Kept at
// the head of the corpus so their near-verbatim text ranks first. ────────────
const BASE_INCIDENTS: Omit<IncidentPayload, 'kind'>[] = [
  {
    equipment_id: 'PUMP-7', equipment_type: 'centrifugal_pump', plant_id: 'IN-04',
    fault_code: 'VIB-201', fault_description:
      'High radial vibration 9.4 mm/s RMS on drive-end bearing, rising over 72 h, audible growl at 1x-3x RPM.',
    root_cause: 'Drive-end bearing outer-race spalling from grease starvation (missed 4000 h relube).',
    fix_applied: 'Replaced DE bearing 6312-C3, relubed NDE, torqued bearing cap to 45 Nm cross-pattern, verified vibration 2.1 mm/s.',
    time_to_resolve_minutes: 142, severity: 'high', outcome: 'resolved',
    technician_id: 'T-1043', timestamp: '2025-11-18T09:40:00Z',
  },
  {
    equipment_id: 'PUMP-7', equipment_type: 'centrifugal_pump', plant_id: 'IN-04',
    fault_code: 'VIB-118', fault_description:
      'Vibration 7.8 mm/s dominant at 1x RPM after impeller service, phase readings unstable.',
    root_cause: 'Impeller imbalance — trim weld performed without re-balancing.',
    fix_applied: 'Field-balanced rotor to G2.5, verified 1.9 mm/s. Added balancing to impeller-service checklist.',
    time_to_resolve_minutes: 210, severity: 'medium', outcome: 'resolved',
    technician_id: 'T-0871', timestamp: '2025-08-02T13:15:00Z',
  },
  {
    equipment_id: 'PUMP-3', equipment_type: 'centrifugal_pump', plant_id: 'IN-02',
    fault_code: 'SEAL-044', fault_description:
      'Mechanical seal weep 20 drops/min escalating to spray; product visible on baseplate.',
    root_cause: 'Dry-run event during suction strainer blockage burned seal faces.',
    fix_applied: 'Replaced cartridge seal, cleared strainer, added low-suction-pressure interlock test to PM.',
    time_to_resolve_minutes: 165, severity: 'high', outcome: 'resolved',
    technician_id: 'T-1101', timestamp: '2025-09-27T05:50:00Z',
  },
  {
    equipment_id: 'PUMP-11', equipment_type: 'centrifugal_pump', plant_id: 'IN-07',
    fault_code: 'TEMP-090', fault_description:
      'DE bearing temperature 96 °C alarm (limit 85 °C), grease purging dark from labyrinth.',
    root_cause: 'Over-greasing churned bearing; thermal runaway.',
    fix_applied: 'Purged excess grease, set 15 g/4000 h regime per OEM, temp stabilised 61 °C.',
    time_to_resolve_minutes: 75, severity: 'medium', outcome: 'resolved',
    technician_id: 'T-0417', timestamp: '2026-01-12T11:05:00Z',
  },
  {
    equipment_id: 'PUMP-2', equipment_type: 'centrifugal_pump', plant_id: 'IN-04',
    fault_code: 'CAV-013', fault_description:
      'Gravel-like noise, fluctuating discharge pressure, vibration broadband high frequency.',
    root_cause: 'Cavitation — NPSH margin lost after upstream filter fouled.',
    fix_applied: 'Cleaned filter, raised tank min level setpoint, throttled discharge to curve. Noise cleared.',
    time_to_resolve_minutes: 88, severity: 'medium', outcome: 'resolved',
    technician_id: 'T-1043', timestamp: '2025-07-19T16:22:00Z',
  },
  {
    equipment_id: 'COMP-2', equipment_type: 'compressor', plant_id: 'IN-04',
    fault_code: 'HT-310', fault_description:
      'GA75 tripping on discharge temperature 112 °C within 20 min of load, ambient 38 °C.',
    root_cause: 'Oil cooler fins packed with cotton lint; thermostatic valve sluggish.',
    fix_applied: 'Blew coolers inside-out at 6 bar, replaced thermostatic element, trip cleared, running 87 °C.',
    time_to_resolve_minutes: 130, severity: 'high', outcome: 'resolved',
    technician_id: 'T-0644', timestamp: '2025-10-05T07:30:00Z',
  },
  {
    equipment_id: 'COMP-2', equipment_type: 'compressor', plant_id: 'IN-04',
    fault_code: 'OIL-207', fault_description:
      'Oil carry-over into air net, separator ΔP 1.2 bar, oil top-ups doubling.',
    root_cause: 'Separator element beyond life; scavenge line orifice blocked.',
    fix_applied: 'Replaced separator element, cleared scavenge orifice, ΔP 0.25 bar, carry-over normal.',
    time_to_resolve_minutes: 155, severity: 'medium', outcome: 'resolved',
    technician_id: 'T-0644', timestamp: '2025-06-14T10:00:00Z',
  },
  {
    equipment_id: 'COMP-5', equipment_type: 'compressor', plant_id: 'IN-02',
    fault_code: 'ELE-402', fault_description:
      'Main motor tripping on overload at 92 % load, currents unbalanced 7 %.',
    root_cause: 'Loose T2 lug in motor terminal box heating under load.',
    fix_applied: 'Isolated, re-terminated and torqued lugs to spec, thermographed under load — balanced.',
    time_to_resolve_minutes: 95, severity: 'critical', outcome: 'resolved',
    technician_id: 'T-0989', timestamp: '2025-12-01T14:45:00Z',
  },
  {
    equipment_id: 'CONV-1', equipment_type: 'conveyor', plant_id: 'IN-04',
    fault_code: 'TRK-155', fault_description:
      'Belt drifting hard left at tail, edge fraying, spillage building on return side.',
    root_cause: 'Seized troughing idler 40 m from tail dragging the belt off-centre.',
    fix_applied: 'LOTO with counterweight pinned, replaced two seized idlers, tracked belt over 2 revolutions.',
    time_to_resolve_minutes: 118, severity: 'medium', outcome: 'resolved',
    technician_id: 'T-1150', timestamp: '2025-09-09T03:20:00Z',
  },
  {
    equipment_id: 'CONV-1', equipment_type: 'conveyor', plant_id: 'IN-04',
    fault_code: 'SPL-071', fault_description:
      'Clicking at splice each revolution, mechanical fasteners lifting on one edge.',
    root_cause: 'Splice installed 4 mm out of square; edge stress concentrating on fasteners.',
    fix_applied: 'Cut and re-spliced square with counterweight pinned, retensioned to 1.2 % elongation.',
    time_to_resolve_minutes: 240, severity: 'high', outcome: 'resolved',
    technician_id: 'T-1150', timestamp: '2025-11-30T22:10:00Z',
  },
  {
    equipment_id: 'CONV-3', equipment_type: 'conveyor', plant_id: 'IN-07',
    fault_code: 'GBX-233', fault_description:
      'Drive gearbox whining under load, oil sample dark with fine brass glitter.',
    root_cause: 'Bronze worm-wheel wear from 800 h overdue oil change (CLP 220 degraded).',
    fix_applied: 'Escalated: gearbox swap scheduled; interim oil change and load cap 70 %.',
    time_to_resolve_minutes: 60, severity: 'high', outcome: 'escalated',
    technician_id: 'T-0417', timestamp: '2026-02-08T08:55:00Z',
  },
  {
    equipment_id: 'PUMP-7', equipment_type: 'centrifugal_pump', plant_id: 'IN-04',
    fault_code: 'VIB-201', fault_description:
      'Repeat vibration alarm 8.2 mm/s DE bearing six months after last bearing change.',
    root_cause: 'Bearing cap over-torqued to ~80 Nm in previous repair distorted outer race (OEM limit 45 Nm).',
    fix_applied: 'Replaced bearing, torqued cap to 45 Nm two-pass cross pattern per manual 7.3, added torque-wrench verification to sign-off.',
    time_to_resolve_minutes: 150, severity: 'high', outcome: 'resolved',
    technician_id: 'T-0871', timestamp: '2026-03-21T12:00:00Z',
  },
];

// ── Corpus composition — the 12 anchors + the deterministic 15-year history ──
// `buildFullHistory` is the single source of truth: every incident (base and
// generated) carries a stable id and a sibling cost record for the analytics
// layer. The base anchors come first so retrieval still ranks them highest.
let _full: HistoryIncident[] | null = null;
export function buildFullHistory(): HistoryIncident[] {
  if (_full) return _full;
  const base: HistoryIncident[] = BASE_INCIDENTS.map((b, i) => {
    const payload: IncidentPayload = { kind: 'incident', ...b };
    return {
      id: `INCB-${String(i + 1).padStart(4, '0')}`,
      payload,
      cost: makeCost(b.equipment_id, b.time_to_resolve_minutes, b.severity, b.outcome === 'escalated'),
    };
  });
  _full = [...base, ...generateHistory().incidents];
  return _full;
}

// The Qdrant-facing corpus: pure IncidentPayload[] (schema-clean, no ids/costs).
export function buildIncidentCorpus(): IncidentPayload[] {
  return buildFullHistory().map((h) => h.payload);
}

// ── Vetted runbook library (skill-gated — PRD §11 auth-level filter) ─────────
export const RUNBOOK_LIBRARY: RunbookPayload[] = [
  {
    kind: 'runbook', equipment_type: 'centrifugal_pump', fault_category: 'bearing_failure',
    title: 'DE/NDE rolling-element bearing replacement (CR-frame)',
    skill_level_required: 2, estimated_minutes: 150, safety_rating: 'danger',
    steps: [
      'Perform full LOTO per manual 2.1 (breaker locked, valves locked, casing vented to 0, test start).',
      'Verify bearing temperature < 40 °C or wear heat gloves; remove coupling guard AFTER zero-energy proof.',
      'Pull coupling hub, remove bearing housing cap, extract bearing with puller — never hammer the shaft.',
      'Fit new bearing (induction heater 110 °C max), seat square to shoulder.',
      'Torque bearing cap to OEM spec 45 Nm, two passes cross-pattern (25 → 45).',
      'Relube 15 g SF-2, refit guard, remove locks in reverse order, run and verify vibration < 2.8 mm/s.',
    ],
  },
  {
    kind: 'runbook', equipment_type: 'centrifugal_pump', fault_category: 'seal_leak',
    title: 'Cartridge mechanical seal replacement',
    skill_level_required: 2, estimated_minutes: 180, safety_rating: 'danger',
    steps: [
      'LOTO per manual 2.1 including casing vent — seal chamber holds pressure.',
      'Drain casing to safe containment; confirm zero pressure at gauge.',
      'Remove coupling spacer, back off gland bolts evenly, withdraw cartridge.',
      'Inspect shaft sleeve for scoring; replace if > 0.05 mm wear.',
      'Fit new cartridge, set spring compression per seal card, torque gland evenly.',
      'Remove setting clips, restore, leak-test at operating pressure for 15 min.',
    ],
  },
  {
    kind: 'runbook', equipment_type: 'compressor', fault_category: 'high_temperature',
    title: 'GA75 high discharge temperature diagnosis & cooler service',
    skill_level_required: 2, estimated_minutes: 120, safety_rating: 'caution',
    steps: [
      'LOTO per manual 2.3: electrical lock, air-net valve closed, receiver vented to 0 bar, 3 min equalise.',
      'Check oil level and top up Roto-Inject if below sight-glass midpoint.',
      'Blow oil-cooler and after-cooler fins inside-out with dry air ≤ 6 bar.',
      'Test thermostatic valve element in 80 °C water bath — replace if stroke < spec.',
      'Restore, run loaded 20 min, log discharge temperature — must hold < 100 °C.',
      'If still tripping, escalate for oil-cooler core replacement (L3).',
    ],
  },
  {
    kind: 'runbook', equipment_type: 'conveyor', fault_category: 'belt_mistracking',
    title: 'Belt tracking correction & idler replacement',
    skill_level_required: 1, estimated_minutes: 90, safety_rating: 'caution',
    steps: [
      'LOTO per manual 2.2 INCLUDING gravity take-up winch lock and counterweight pin.',
      'Walk the belt: identify seized/frozen idlers by rotation test and heat marks.',
      'Replace seized idlers; clean snub pulley buildup with scraper — never while belt moves.',
      'Release locks per procedure, run belt, adjust training idlers 3 mm per pass.',
      'Allow 2 full revolutions between adjustments; confirm belt centred at head and tail.',
      'Log final tracking offset and idler positions in CMMS.',
    ],
  },
  {
    kind: 'runbook', equipment_type: 'compressor', fault_category: 'electrical_overload',
    title: 'Motor overload trip investigation (MCC + terminations)',
    skill_level_required: 3, estimated_minutes: 110, safety_rating: 'danger',
    steps: [
      'Electrical isolation and LOTO; prove dead with two-pole tester on all phases.',
      'Open terminal box, inspect lugs for heat discolouration, re-torque to lug spec.',
      'Megger motor windings phase-phase and phase-earth; record and compare history.',
      'Check overload relay setting matches FLA nameplate.',
      'Restore, thermograph terminations under load within 30 min.',
      'If imbalance persists > 5 %, escalate to motor shop.',
    ],
  },
  // ── Added depth (PART A6) — more procedures across types & skill levels ────
  {
    kind: 'runbook', equipment_type: 'centrifugal_pump', fault_category: 'cavitation',
    title: 'Cavitation / NPSH loss diagnosis',
    skill_level_required: 1, estimated_minutes: 70, safety_rating: 'caution',
    steps: [
      'LOTO per manual 2.1 before touching suction-side components.',
      'Inspect and clean the suction strainer; check for upstream filter fouling.',
      'Verify tank level above the minimum-level interlock setpoint.',
      'Check suction-line valves fully open and gaskets not drawing air.',
      'Restore, run and confirm stable discharge pressure and no crackle.',
      'Log NPSH margin and update the min-level setpoint if required.',
    ],
  },
  {
    kind: 'runbook', equipment_type: 'centrifugal_pump', fault_category: 'misalignment',
    title: 'Shaft alignment & soft-foot correction',
    skill_level_required: 2, estimated_minutes: 120, safety_rating: 'caution',
    steps: [
      'LOTO per manual 2.1; remove coupling guard after zero-energy proof.',
      'Dial or laser check soft-foot at each foot; correct below 0.05 mm.',
      'Measure parallel and angular offset; record cold readings.',
      'Shim and move to 0.05 mm targets including thermal-growth offset per 7.5.',
      'Refit coupling element and guard; run and verify 2x vibration cleared.',
      'Log final alignment and update baseline.',
    ],
  },
  {
    kind: 'runbook', equipment_type: 'compressor', fault_category: 'oil_carryover',
    title: 'GA75 separator element & scavenge service',
    skill_level_required: 2, estimated_minutes: 150, safety_rating: 'danger',
    steps: [
      'LOTO per manual 2.3: electrical lock, air-net valve closed, receiver vented to 0 bar, 3 min equalise.',
      'Confirm separator tank bled to 0 bar at the gauge before opening the cover.',
      'Remove separator cover (bolts 60 Nm on refit) and replace the element.',
      'Clear the scavenge line orifice and check-valve; confirm free flow.',
      'Refit with new gasket, top up Roto-Inject oil, restore per procedure.',
      'Run loaded 20 min; confirm separator ΔP < 0.4 bar and no carry-over.',
    ],
  },
  {
    kind: 'runbook', equipment_type: 'compressor', fault_category: 'air_leak',
    title: 'Air-net leak survey & repair',
    skill_level_required: 1, estimated_minutes: 90, safety_rating: 'safe',
    steps: [
      'Run an ultrasonic leak survey across the distribution net off-peak.',
      'Tag each leak; isolate the affected drop before repair.',
      'Tighten unions, replace failed quick-couplers and perished hoses.',
      'Rebuild any condensate drain stuck open.',
      'Re-survey and confirm off-load pressure decay eliminated.',
      'Log estimated leakage flow recovered in CMMS.',
    ],
  },
  {
    kind: 'runbook', equipment_type: 'conveyor', fault_category: 'splice_failure',
    title: 'Belt splice repair (mechanical / vulcanised)',
    skill_level_required: 2, estimated_minutes: 260, safety_rating: 'danger',
    steps: [
      'LOTO per manual 2.2 INCLUDING gravity take-up winch lock and counterweight pin.',
      'Relieve belt tension safely; confirm counterweight pinned before cutting.',
      'Cut the splice square within 1 mm; prepare belt ends per repair guide 4.9.',
      'Install mechanical fasteners or vulcanised splice per duty.',
      'Release locks per procedure; retension belt to 1.2 % elongation.',
      'Run 2 revolutions; re-tension fasteners after 8 h; log the repair.',
    ],
  },
  {
    kind: 'runbook', equipment_type: 'conveyor', fault_category: 'idler_replacement',
    title: 'Seized idler replacement & drag reduction',
    skill_level_required: 1, estimated_minutes: 80, safety_rating: 'caution',
    steps: [
      'LOTO per manual 2.2 including take-up winch lock and counterweight pin.',
      'Walk the run; mark seized/flat idlers by rotation and heat marks.',
      'Replace seized carrying and return idlers; clean frames of fines.',
      'Verify free rotation across each span before releasing locks.',
      'Run and confirm drag current back to normal; check belt tracking.',
      'Add idler-rotation check to the weekly PM.',
    ],
  },
  {
    kind: 'runbook', equipment_type: 'conveyor', fault_category: 'gearbox_wear',
    title: 'Drive gearbox oil service & wear assessment',
    skill_level_required: 3, estimated_minutes: 130, safety_rating: 'danger',
    steps: [
      'LOTO per manual 2.2; isolate drive motor and lock, pin counterweight.',
      'Drain and inspect gearbox oil; take a wear-metal sample for analysis.',
      'Assess backlash and input-shaft bearing condition.',
      'Refill with CLP 220 (1.8 L) or schedule gearbox swap if wear metals high.',
      'If swapping, align drive and re-torque locking assembly (195 Nm).',
      'Run and verify temperature and noise normal; trend the oil sample.',
    ],
  },
];
