// GET /api/fleet — one-click demo fault presets for the hero assets. The full
// history-derived fleet now lives at /api/assets; this endpoint just carries the
// scripted "Inject fault" presets the live demo uses, with health pulled from
// the real analytics layer so the two surfaces agree.
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, rateLimit } from '@/lib/auth';
import { assetSummary } from '@/lib/analytics';

const FLEET = [
  {
    equipmentId: 'PUMP-7', equipmentType: 'centrifugal_pump', plantId: 'IN-04',
    name: 'Grundfos CR95 — Cooling Water Pump #7', health: 62,
    preset: {
      faultCode: 'VIB-201', severity: 'high', reportedBy: 'sensor',
      description: 'High radial vibration 9.1 mm/s RMS on drive-end bearing, trending up over 48 h, audible growl at 1x-3x RPM.',
    },
  },
  {
    equipmentId: 'COMP-2', equipmentType: 'compressor', plantId: 'IN-04',
    name: 'Atlas Copco GA75 — Instrument Air #2', health: 71,
    preset: {
      faultCode: 'HT-310', severity: 'high', reportedBy: 'sensor',
      description: 'Discharge temperature 111 °C trip within 25 minutes of loaded run; ambient 39 °C; oil level mid sight-glass.',
    },
  },
  {
    equipmentId: 'CONV-1', equipmentType: 'conveyor', plantId: 'IN-04',
    name: 'Flexco/Siemens — Clinker Belt Conveyor #1', health: 78,
    preset: {
      faultCode: 'TRK-155', severity: 'medium', reportedBy: 'operator',
      description: 'Belt drifting hard left at the tail pulley, edge fraying visible, spillage building on the return side.',
    },
  },
];

export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;
  // Overlay live health from the analytics layer (falls back to the seed value).
  const fleet = FLEET.map((f) => ({ ...f, health: assetSummary(f.equipmentId)?.health ?? f.health }));
  return NextResponse.json({ fleet });
}
