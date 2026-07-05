// GET /api/workorders — the maintenance work-order queue, derived from recent
// incidents and merged with any live Sentinel runs in progress (PART B).
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, rateLimit } from '@/lib/auth';
import { workOrdersFromHistory, type WorkOrder } from '@/lib/analytics';
import { listRuns } from '@/lib/run-registry';

export async function GET(req: NextRequest) {
  const limited = rateLimit(req);
  if (limited) return limited;
  const auth = await requireAuth(req);
  if ('error' in auth) return auth.error;

  const history = workOrdersFromHistory(40);

  // Merge live runs so an in-flight fault appears at the top of the queue.
  const live: WorkOrder[] = listRuns().map((r) => ({
    id: r.workOrderId ?? `WO-${r.runId.slice(0, 6).toUpperCase()}`,
    assetId: r.fault.equipmentId, plantId: r.fault.plantId, faultCode: r.fault.faultCode,
    severity: r.fault.severity,
    status: r.stage === 'DONE' ? 'closed' : r.stage === 'SUSPENDED' ? 'open' : 'in_progress',
    openedAt: r.startedAt, technicianId: r.approval?.technicianId ?? '—',
    description: r.fault.description, source: 'live',
  }));

  const open = [...live, ...history];
  const summary = {
    total: open.length,
    open: open.filter((w) => w.status === 'open').length,
    inProgress: open.filter((w) => w.status === 'in_progress').length,
    closed: open.filter((w) => w.status === 'closed').length,
    live: live.length,
  };
  return NextResponse.json({ workOrders: open, summary });
}
