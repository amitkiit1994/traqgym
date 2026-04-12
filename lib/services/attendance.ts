import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

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

  const log = await prisma.attendanceLog.create({
    data: {
      userId: params.userId ?? null,
      workerId: params.workerId ?? null,
      locationId: params.locationId,
      attendanceDate: today,
      checkIn: new Date(),
      source: params.source ?? "manual",
    },
  });

  return { success: true as const, id: log.id, existing: false };
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
  const startOfDay = new Date(params.date.getFullYear(), params.date.getMonth(), params.date.getDate());

  return prisma.attendanceLog.findMany({
    where: {
      attendanceDate: startOfDay,
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
