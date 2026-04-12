"use server";

import { prisma } from "@/lib/prisma";
import { checkIn, checkOut } from "@/lib/services/attendance";
import { requireWorker } from "@/lib/auth-guard";
import { workerCheckInSchema, zodErrors } from "@/lib/validations";

export async function getWorkerDailyAttendance(
  dateStr: string,
  locationId?: number
) {
  try { await requireWorker(); } catch { return []; }
  const date = new Date(dateStr);
  const startOfDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate()
  );

  const logs = await prisma.attendanceLog.findMany({
    where: {
      attendanceDate: startOfDay,
      workerId: { not: null },
      ...(locationId ? { locationId } : {}),
    },
    include: {
      worker: { select: { id: true, firstname: true, lastname: true, role: true } },
      location: { select: { id: true, name: true } },
    },
    orderBy: { checkIn: "desc" },
  });

  return logs.map((log) => ({
    id: log.id,
    workerId: log.workerId!,
    workerName: log.worker
      ? `${log.worker.firstname} ${log.worker.lastname}`
      : "Unknown",
    workerRole: log.worker?.role ?? "staff",
    checkIn: log.checkIn.toISOString(),
    checkOut: log.checkOut?.toISOString() ?? null,
    source: log.source,
    locationName: log.location.name,
  }));
}

export async function getWorkersList() {
  try { await requireWorker(); } catch { return []; }
  return prisma.worker.findMany({
    where: { isActive: true },
    select: { id: true, firstname: true, lastname: true, role: true },
    orderBy: [{ firstname: "asc" }, { lastname: "asc" }],
  });
}

export async function workerCheckIn(workerId: number, locationId: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  const parsed = workerCheckInSchema.safeParse({ workerId, locationId });
  if (!parsed.success) return { success: false, error: Object.values(zodErrors(parsed.error))[0] };
  try {
    const result = await checkIn({ workerId, locationId, source: "manual" });
    return result;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function workerCheckOut(attendanceId: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  try {
    const log = await prisma.attendanceLog.findUnique({
      where: { id: attendanceId },
    });
    if (!log) return { success: false, error: "Record not found" };
    if (log.checkOut) return { success: false, error: "Already checked out" };

    await prisma.attendanceLog.update({
      where: { id: attendanceId },
      data: { checkOut: new Date() },
    });
    return { success: true, id: attendanceId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
