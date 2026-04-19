"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  openShift,
  closeShift,
  recordMovement,
  listOpenShifts,
  listClosedShifts,
  listPendingApprovalShifts,
  getShiftDetail,
  getOpenShiftsCount,
  type ShiftMovementType,
  type ShiftRow,
  type ShiftMovementRow,
} from "@/lib/services/cash-shift";

type ActionResult<T = undefined> =
  | { success: true; data?: T }
  | { success: false; error: string };

function unauthorized<T = undefined>(): ActionResult<T> {
  return { success: false, error: "Unauthorized" };
}

// ─── openShiftAction (any worker) ────────────────────────────────────────
export async function openShiftAction(params: {
  locationId: number;
  openingFloat: number;
}): Promise<ActionResult<{ shiftId: number }>> {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return unauthorized();
  }
  const openedById = parseInt(session.user.id, 10);
  const res = await openShift({
    locationId: params.locationId,
    openedById,
    openingFloat: params.openingFloat,
  });
  if (!res.success) return { success: false, error: res.error };

  revalidatePath("/admin/shifts");
  revalidateTag("sidebar-counts", "max");
  return { success: true, data: { shiftId: res.shift.id } };
}

// ─── closeShiftAction (any worker) ───────────────────────────────────────
export async function closeShiftAction(params: {
  shiftId: number;
  closingCounted: number;
  varianceReason?: string;
  notes?: string;
}): Promise<
  ActionResult<{
    shiftId: number;
    status: string;
    closingExpected: number;
    variance: number;
    requiresApproval: boolean;
    approvalId?: number;
  }>
> {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return unauthorized();
  }
  const closedById = parseInt(session.user.id, 10);

  // Authz: a staff worker may only close shifts at their own location. Admins
  // may close any shift. Reason: prevents Location-A staff from closing
  // Location-B's shift (drawer counts and variance approvals must stay with
  // the staff who actually held the cash).
  const role = session.user.role;
  if (role !== "admin") {
    const shift = await prisma.cashShift.findUnique({
      where: { id: params.shiftId },
      select: { locationId: true },
    });
    if (!shift) return { success: false, error: "Shift not found" };
    const callerLocationId = session.user.locationId;
    if (callerLocationId == null || callerLocationId !== shift.locationId) {
      return { success: false, error: "Forbidden: not your shift's location" };
    }
  }

  const res = await closeShift({
    shiftId: params.shiftId,
    closedById,
    closingCounted: params.closingCounted,
    varianceReason: params.varianceReason,
    notes: params.notes,
  });
  if (!res.success) return { success: false, error: res.error };

  revalidatePath("/admin/shifts");
  revalidatePath("/admin/approvals");
  revalidateTag("sidebar-counts", "max");

  return {
    success: true,
    data: {
      shiftId: res.shiftId,
      status: res.status,
      closingExpected: res.closingExpected,
      variance: res.variance,
      requiresApproval: res.requiresApproval,
      approvalId: res.approvalId,
    },
  };
}

// ─── recordMovementAction (any worker) ───────────────────────────────────
export async function recordMovementAction(params: {
  shiftId: number;
  type: ShiftMovementType;
  amount: number;
  reason: string;
}): Promise<ActionResult<{ movementId: number }>> {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return unauthorized();
  }
  const createdById = parseInt(session.user.id, 10);

  const res = await recordMovement({
    shiftId: params.shiftId,
    type: params.type,
    amount: params.amount,
    reason: params.reason,
    createdById,
  });
  if (!res.success) return { success: false, error: res.error };

  revalidatePath("/admin/shifts");
  return { success: true, data: { movementId: res.movement.id } };
}

// ─── Read actions ────────────────────────────────────────────────────────
export async function listOpenShiftsAction(opts?: {
  locationId?: number;
}): Promise<
  | { success: true; data: ShiftRow[] }
  | { success: false; error: string; data: ShiftRow[] }
> {
  try {
    await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized", data: [] };
  }
  const data = await listOpenShifts(opts);
  return { success: true, data };
}

export async function listClosedShiftsAction(opts?: {
  locationId?: number;
  from?: string;
  to?: string;
}): Promise<
  | { success: true; data: ShiftRow[] }
  | { success: false; error: string; data: ShiftRow[] }
> {
  try {
    await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized", data: [] };
  }
  const data = await listClosedShifts({
    locationId: opts?.locationId,
    from: opts?.from ? new Date(opts.from) : undefined,
    to: opts?.to ? new Date(opts.to) : undefined,
  });
  return { success: true, data };
}

export async function listPendingApprovalShiftsAction(): Promise<
  | { success: true; data: ShiftRow[] }
  | { success: false; error: string; data: ShiftRow[] }
> {
  try {
    await requireWorker();
  } catch {
    return { success: false, error: "Unauthorized", data: [] };
  }
  const data = await listPendingApprovalShifts();
  return { success: true, data };
}

export async function getShiftDetailAction(
  id: number
): Promise<
  ActionResult<(ShiftRow & { movements: ShiftMovementRow[] }) | null>
> {
  try {
    await requireWorker();
  } catch {
    return unauthorized();
  }
  const data = await getShiftDetail(id);
  return { success: true, data };
}

export async function getOpenShiftsCountAction(): Promise<number> {
  try {
    await requireWorker();
  } catch {
    return 0;
  }
  return getOpenShiftsCount();
}
