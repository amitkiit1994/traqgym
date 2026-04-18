import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";
import { istDayBoundsUtc } from "@/lib/utils/date-ist";

/** Parses an "HH:MM" 24h time string into total minutes from midnight. Returns null on invalid. */
function parseHHMM(value: string | undefined | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/** Computes IST minutes-since-midnight from a given Date. */
function istMinutes(d: Date): number {
  // IST = UTC+5:30
  const utc = d.getTime() + d.getTimezoneOffset() * 60_000;
  const ist = new Date(utc + 5.5 * 60 * 60_000);
  return ist.getHours() * 60 + ist.getMinutes();
}

async function computeTimeFlags(now: Date): Promise<{
  isPeakHours: boolean;
  isLateEntry: boolean;
}> {
  const [peakStart, peakEnd, lateAfter] = await Promise.all([
    prisma.gymSettings.findUnique({ where: { key: "peak_hours_start" } }),
    prisma.gymSettings.findUnique({ where: { key: "peak_hours_end" } }),
    prisma.gymSettings.findUnique({ where: { key: "late_entry_after" } }),
  ]);

  const minutes = istMinutes(now);
  const peakStartMin = parseHHMM(peakStart?.value) ?? parseHHMM("06:00")!;
  const peakEndMin = parseHHMM(peakEnd?.value) ?? parseHHMM("09:00")!;
  const lateAfterMin = parseHHMM(lateAfter?.value) ?? parseHHMM("22:00")!;

  const isPeakHours = minutes >= peakStartMin && minutes < peakEndMin;
  const isLateEntry = minutes >= lateAfterMin;

  return { isPeakHours, isLateEntry };
}

export async function checkIn(params: {
  userId?: number;
  workerId?: number;
  locationId: number;
  source?: string;
}) {
  if (!params.userId && !params.workerId) {
    throw new Error("Either userId or workerId must be provided");
  }
  if (params.userId && params.workerId) {
    throw new Error("Only one of userId or workerId must be provided");
  }

  const today = todayIST();

  // Membership validation for member check-ins (not workers)
  if (params.userId) {
    const activeMembership = await prisma.memberTicket.findFirst({
      where: {
        userId: params.userId,
        expireDate: { gte: today },
      },
    });
    if (!activeMembership) {
      // Check grace period from GymSettings
      const graceSetting = await prisma.gymSettings.findUnique({
        where: { key: "grace_period_days" },
      });
      const graceDays = graceSetting ? parseInt(graceSetting.value, 10) : 0;
      if (graceDays > 0) {
        const graceDate = todayIST();
        graceDate.setDate(graceDate.getDate() - graceDays);
        const graceTicket = await prisma.memberTicket.findFirst({
          where: { userId: params.userId, expireDate: { gte: graceDate } },
        });
        if (!graceTicket) {
          return { success: false as const, error: "Membership expired" };
        }
      } else {
        return { success: false as const, error: "Membership expired" };
      }
    }
  }

  // Check existing attendance today at this location (idempotent)
  const existing = await prisma.attendanceLog.findFirst({
    where: {
      ...(params.userId ? { userId: params.userId } : { workerId: params.workerId }),
      locationId: params.locationId,
      attendanceDate: today,
    },
  });

  if (existing) {
    return { success: true as const, id: existing.id, existing: true };
  }

  const now = new Date();
  const flags = await computeTimeFlags(now);

  const log = await prisma.attendanceLog.create({
    data: {
      userId: params.userId ?? null,
      workerId: params.workerId ?? null,
      locationId: params.locationId,
      attendanceDate: today,
      checkIn: now,
      source: params.source ?? "manual",
      isPeakHours: flags.isPeakHours,
      isLateEntry: flags.isLateEntry,
    },
  });

  return {
    success: true as const,
    id: log.id,
    existing: false,
    isPeakHours: flags.isPeakHours,
    isLateEntry: flags.isLateEntry,
  };
}

export async function checkOut(params: {
  userId?: number;
  workerId?: number;
  locationId: number;
}) {
  const today = todayIST();

  const log = await prisma.attendanceLog.findFirst({
    where: {
      ...(params.userId ? { userId: params.userId } : { workerId: params.workerId }),
      locationId: params.locationId,
      attendanceDate: today,
      checkOut: null,
    },
  });

  if (!log) {
    return { success: false, error: "No open check-in found" };
  }

  await prisma.attendanceLog.update({
    where: { id: log.id },
    data: { checkOut: new Date() },
  });

  return { success: true, id: log.id };
}

export async function getDaily(params: {
  date: Date;
  locationId?: number;
}) {
  // attendanceDate is stored as the IST midnight Date (via todayIST), which
  // serializes to a UTC instant of the prior calendar day at 18:30 UTC.
  // Build IST-aware UTC bounds so we match exactly that instant range.
  const { startUtc, endUtc } = istDayBoundsUtc(params.date);

  return prisma.attendanceLog.findMany({
    where: {
      attendanceDate: { gte: startUtc, lt: endUtc },
      ...(params.locationId ? { locationId: params.locationId } : {}),
    },
    include: {
      user: { select: { id: true, firstname: true, lastname: true } },
      worker: { select: { id: true, firstname: true, lastname: true } },
      location: { select: { id: true, name: true } },
    },
    orderBy: { checkIn: "desc" },
  });
}

export async function getMonthly(params: {
  year: number;
  month: number; // 1-indexed
  locationId?: number;
  userId?: number;
}) {
  const startDate = new Date(params.year, params.month - 1, 1);
  const endDate = new Date(params.year, params.month, 0); // last day of month

  return prisma.attendanceLog.findMany({
    where: {
      attendanceDate: { gte: startDate, lte: endDate },
      ...(params.locationId ? { locationId: params.locationId } : {}),
      ...(params.userId ? { userId: params.userId } : {}),
    },
    include: {
      user: { select: { id: true, firstname: true, lastname: true } },
      worker: { select: { id: true, firstname: true, lastname: true } },
      location: { select: { id: true, name: true } },
    },
    orderBy: { attendanceDate: "asc" },
  });
}
