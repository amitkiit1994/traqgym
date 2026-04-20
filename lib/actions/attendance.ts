"use server";

import { checkIn, checkOut, getDaily } from "@/lib/services/attendance";
import { prisma } from "@/lib/prisma";
import { revalidateTag } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import { manualCheckInSchema, zodErrors } from "@/lib/validations";

export async function getAttendanceMembers() {
  try { await requireWorker(); } catch { return []; }
  return prisma.user.findMany({
    select: { id: true, firstname: true, lastname: true },
    orderBy: [{ firstname: "asc" }, { lastname: "asc" }],
  });
}

export async function getAttendanceLocations() {
  try { await requireWorker(); } catch { return []; }
  return prisma.location.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function getDailyAttendance(dateStr: string, locationId?: number) {
  try { await requireWorker(); } catch { return []; }
  const date = new Date(dateStr);
  const logs = await getDaily({ date, locationId });

  return logs.map((log) => ({
    id: log.id,
    memberName: log.user
      ? `${log.user.firstname} ${log.user.lastname}`
      : log.worker
        ? `${log.worker.firstname} ${log.worker.lastname} (Staff)`
        : "Unknown",
    checkIn: log.checkIn.toISOString(),
    checkOut: log.checkOut?.toISOString() ?? null,
    source: log.source,
    locationName: log.location.name,
    isLateEntry: log.isLateEntry,
    isPeakHours: log.isPeakHours,
  }));
}

export async function manualCheckIn(userId: number, locationId: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  const parsed = manualCheckInSchema.safeParse({ userId, locationId });
  if (!parsed.success) return { success: false, error: Object.values(zodErrors(parsed.error))[0] };
  try {
    const result = await checkIn({ userId, locationId, source: "manual" });
    if (!result.success) {
      // H2 root-cause: the service returns { success: false, error: "Membership expired" }
      // for users with no active ticket. Previously the action returned this silently,
      // so a 200 response with no AttendanceLog row looked like an unrelated failure.
      // Log so the trail exists; the existing UI already surfaces result.error.
      console.warn(`[manualCheckIn] service reported failure for user=${userId} loc=${locationId}: ${"error" in result ? result.error : "unknown"}`);
      return result;
    }
    revalidateTag("attendance", "max");
    revalidateTag("dashboard", "max");
    return result;
  } catch (err) {
    console.error(`[manualCheckIn] threw for user=${userId} loc=${locationId}:`, err);
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function checkOutAttendance(attendanceLogId: number) {
  try { await requireWorker(); } catch { return { success: false as const, error: "Unauthorized" }; }
  if (!Number.isFinite(attendanceLogId) || attendanceLogId <= 0) {
    return { success: false as const, error: "Invalid attendance id" };
  }
  try {
    const log = await prisma.attendanceLog.findUnique({ where: { id: attendanceLogId } });
    if (!log) return { success: false as const, error: "Attendance log not found" };
    if (log.checkOut) return { success: false as const, error: "Already checked out" };

    // Reuse the service helper for symmetry with member/worker check-out flows;
    // pass the same identity and location so the service updates the matching row.
    const result = await checkOut({
      userId: log.userId ?? undefined,
      workerId: log.workerId ?? undefined,
      locationId: log.locationId,
    });
    if (!result.success) {
      console.warn(`[checkOutAttendance] service reported failure for id=${attendanceLogId}: ${"error" in result ? result.error : "unknown"}`);
      return result;
    }
    revalidateTag("attendance", "max");
    revalidateTag("dashboard", "max");
    return { success: true as const, id: attendanceLogId };
  } catch (err) {
    console.error(`[checkOutAttendance] threw for id=${attendanceLogId}:`, err);
    return { success: false as const, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
