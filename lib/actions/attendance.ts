"use server";

import { checkIn, getDaily } from "@/lib/services/attendance";
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
  }));
}

export async function manualCheckIn(userId: number, locationId: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  const parsed = manualCheckInSchema.safeParse({ userId, locationId });
  if (!parsed.success) return { success: false, error: Object.values(zodErrors(parsed.error))[0] };
  try {
    const result = await checkIn({ userId, locationId, source: "manual" });
    revalidateTag("attendance", "max");
    revalidateTag("dashboard", "max");
    return result;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
