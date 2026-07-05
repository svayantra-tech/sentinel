// ─────────────────────────────────────────────────────────────────────────────
// CMMS integration (FR-02/FR-12 — PRD §10)
//
// The CMMS (SAP PM / IBM Maximo in production) is modelled as an MCP tool
// surface: createWorkOrder · updateWorkOrder · getAssetInfo.
//
// Two consumption paths, same functions:
//   1. In-process tool calls from the Mastra workflow (default — reliable).
//   2. A standalone MCP SERVER (src/mcp/cmms-server.ts) exposing the same
//      tools over stdio — judges can connect MCP Inspector or any MCP client
//      and drive the CMMS directly. Real protocol, not a label.
// Work orders persist to cmms-workorders.json (simulating the external system
// of record). Swapping in SAP PM = replacing this module's internals only.
// ─────────────────────────────────────────────────────────────────────────────
import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { traceStep } from '@/lib/telemetry';

const WO_FILE = path.join(process.cwd(), 'cmms-workorders.json');

export interface WorkOrder {
  id: string;
  equipmentId: string;
  plantId: string;
  faultCode: string;
  description: string;
  priority: 'P1' | 'P2' | 'P3';
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';
  createdAt: string;
  updatedAt: string;
  resolution?: { rootCause: string; fixApplied: string; minutes: number };
}

async function readAll(): Promise<WorkOrder[]> {
  try {
    return JSON.parse(await fs.readFile(WO_FILE, 'utf8')) as WorkOrder[];
  } catch {
    return [];
  }
}
async function writeAll(list: WorkOrder[]): Promise<void> {
  await fs.writeFile(WO_FILE, JSON.stringify(list, null, 2));
}

export const CreateWorkOrderInput = z.object({
  equipmentId: z.string(),
  plantId: z.string(),
  faultCode: z.string(),
  description: z.string(),
  severity: z.enum(['critical', 'high', 'medium']),
});
export type CreateWorkOrderInput = z.infer<typeof CreateWorkOrderInput>;

export async function createWorkOrder(
  input: CreateWorkOrderInput,
  trace: { correlationId: string; runId?: string },
): Promise<WorkOrder> {
  return traceStep(
    {
      step: 'mcp.cmms.createWorkOrder', kind: 'mcp',
      correlationId: trace.correlationId, runId: trace.runId,
      attrs: { equipment: input.equipmentId, plant: input.plantId },
    },
    async () => {
      const wo: WorkOrder = {
        id: `WO-${randomUUID().slice(0, 8).toUpperCase()}`,
        equipmentId: input.equipmentId,
        plantId: input.plantId,
        faultCode: input.faultCode,
        description: input.description,
        priority: input.severity === 'critical' ? 'P1' : input.severity === 'high' ? 'P2' : 'P3',
        status: 'OPEN',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const all = await readAll();
      all.push(wo);
      await writeAll(all);
      return wo;
    },
  );
}

export const UpdateWorkOrderInput = z.object({
  workOrderId: z.string(),
  status: z.enum(['IN_PROGRESS', 'COMPLETED']),
  resolution: z.object({
    rootCause: z.string(),
    fixApplied: z.string(),
    minutes: z.number().int().positive(),
  }).optional(),
});
export type UpdateWorkOrderInput = z.infer<typeof UpdateWorkOrderInput>;

export async function updateWorkOrder(
  input: UpdateWorkOrderInput,
  trace: { correlationId: string; runId?: string },
): Promise<WorkOrder | null> {
  return traceStep(
    {
      step: 'mcp.cmms.updateWorkOrder', kind: 'mcp',
      correlationId: trace.correlationId, runId: trace.runId,
      attrs: { workOrder: input.workOrderId, status: input.status },
    },
    async () => {
      const all = await readAll();
      const wo = all.find((w) => w.id === input.workOrderId);
      if (!wo) return null;
      wo.status = input.status;
      wo.updatedAt = new Date().toISOString();
      if (input.resolution) wo.resolution = input.resolution;
      await writeAll(all);
      return wo;
    },
  );
}

export async function getAssetInfo(equipmentId: string): Promise<{
  equipmentId: string; openWorkOrders: number; lastWorkOrder?: WorkOrder;
}> {
  const all = await readAll();
  const mine = all.filter((w) => w.equipmentId === equipmentId);
  return {
    equipmentId,
    openWorkOrders: mine.filter((w) => w.status !== 'COMPLETED').length,
    lastWorkOrder: mine[mine.length - 1],
  };
}
