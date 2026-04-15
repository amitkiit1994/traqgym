"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import {
  getLockers,
  createLocker,
  assignLocker,
  releaseLocker,
  setLockerMaintenance,
  deleteLocker,
  markLockerAvailable,
  getLockerStats,
} from "@/lib/services/locker";

const createLockerSchema = z.object({
  number: z.string().min(1, "Locker number is required").max(20),
  locationId: z.number().int().positive("Location is required"),
});

export async function getLockersAction(locationId?: number) {
  try { await requireWorker(["admin"]); } catch { return []; }
  const lockers = await getLockers(locationId);
  return lockers.map((l) => ({
    id: l.id,
    number: l.number,
    locationId: l.locationId,
    locationName: l.location.name,
    status: l.status,
    assignedTo: l.assignedTo,
    assignedUserName: l.user ? `${l.user.firstname} ${l.user.lastname}` : null,
    assignedUserPhone: l.user?.phone ?? null,
    assignedAt: l.assignedAt?.toISOString() ?? null,
    notes: l.notes,
    createdAt: l.createdAt.toISOString(),
  }));
}

export async function createLockerAction(data: { number: string; locationId: number }) {
  try { await requireWorker(["admin"]); } catch { return { error: "Unauthorized" }; }
  const parsed = createLockerSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues;
    return { error: issues[0]?.message || "Invalid data" };
  }
  const result = await createLocker(parsed.data.number, parsed.data.locationId);
  if (result.success) revalidatePath("/admin/lockers");
  return result;
}

export async function assignLockerAction(lockerId: number, userId: number) {
  try { await requireWorker(["admin"]); } catch { return { error: "Unauthorized" }; }
  const result = await assignLocker(lockerId, userId);
  if (result.success) revalidatePath("/admin/lockers");
  return result;
}

export async function releaseLockerAction(lockerId: number) {
  try { await requireWorker(["admin"]); } catch { return { error: "Unauthorized" }; }
  const result = await releaseLocker(lockerId);
  if (result.success) revalidatePath("/admin/lockers");
  return result;
}

export async function setLockerMaintenanceAction(lockerId: number, notes?: string) {
  try { await requireWorker(["admin"]); } catch { return { error: "Unauthorized" }; }
  const result = await setLockerMaintenance(lockerId, notes);
  if (result.success) revalidatePath("/admin/lockers");
  return result;
}

export async function deleteLockerAction(lockerId: number) {
  try { await requireWorker(["admin"]); } catch { return { error: "Unauthorized" }; }
  const result = await deleteLocker(lockerId);
  if (result.success) revalidatePath("/admin/lockers");
  return result;
}

export async function markLockerAvailableAction(lockerId: number) {
  try { await requireWorker(["admin"]); } catch { return { error: "Unauthorized" }; }
  const result = await markLockerAvailable(lockerId);
  if (result.success) revalidatePath("/admin/lockers");
  return result;
}

export async function getLockerStatsAction(locationId?: number) {
  try { await requireWorker(["admin"]); } catch { return { available: 0, assigned: 0, maintenance: 0, total: 0 }; }
  return getLockerStats(locationId);
}
