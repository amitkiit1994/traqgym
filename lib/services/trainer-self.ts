import { prisma } from "@/lib/prisma";
import { getMyPtClients, getTrainerStats } from "@/lib/services/pt";
import { listPayoutsForTrainer } from "@/lib/services/trainer-payout";

/**
 * Trainer-scoped read services. Every query MUST filter by trainerId — a
 * trainer must never see another trainer's data.
 *
 * Pages should obtain trainerId from `requireTrainer()` and pass it in.
 */

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 = Sunday
  // Treat Monday as week start (matches member dashboard convention).
  const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

export type TrainerTodaySession = {
  id: number;
  scheduledAt: string;
  completedAt: string | null;
  status: string;
  notes: string | null;
  packageId: number;
  userId: number;
  userName: string;
  userPhone: string | null;
  sessionsRemaining: number;
};

export async function getMyTodaySessions(
  trainerId: number
): Promise<TrainerTodaySession[]> {
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const sessions = await prisma.ptSession.findMany({
    where: {
      package: { trainerId },
      scheduledAt: { gte: today, lt: tomorrow },
    },
    include: {
      package: {
        include: {
          user: {
            select: { id: true, firstname: true, lastname: true, phone: true },
          },
        },
      },
    },
    orderBy: { scheduledAt: "asc" },
  });

  return sessions.map((s) => ({
    id: s.id,
    scheduledAt: s.scheduledAt.toISOString(),
    completedAt: s.completedAt?.toISOString() ?? null,
    status: s.status,
    notes: s.notes,
    packageId: s.packageId,
    userId: s.package.user.id,
    userName: `${s.package.user.firstname} ${s.package.user.lastname}`,
    userPhone: s.package.user.phone,
    sessionsRemaining: s.package.sessionsTotal - s.package.sessionsUsed,
  }));
}

export type TrainerWeekStats = {
  weekStart: string;
  weekEnd: string;
  sessionsCompleted: number;
  sessionsScheduled: number;
  sessionsNoShow: number;
  sessionsCancelled: number;
  activeClients: number;
  estimatedEarnings: number;
};

export async function getMyWeekStats(
  trainerId: number
): Promise<TrainerWeekStats> {
  const weekStart = startOfWeek(new Date());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const stats = await getTrainerStats(trainerId, {
    from: weekStart,
    to: weekEnd,
  });

  const activeClients = await prisma.ptPackage.findMany({
    where: { trainerId, status: "active" },
    select: { userId: true },
  });
  const uniqueClientIds = new Set(activeClients.map((p) => p.userId));

  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    sessionsCompleted: stats.sessionsByStatus.completed,
    sessionsScheduled: stats.sessionsByStatus.scheduled,
    sessionsNoShow: stats.sessionsByStatus.no_show,
    sessionsCancelled: stats.sessionsByStatus.cancelled,
    activeClients: uniqueClientIds.size,
    estimatedEarnings: stats.commissionEarned,
  };
}

export async function getMyClients(trainerId: number) {
  return getMyPtClients(trainerId);
}

export type TrainerClientDetail = {
  userId: number;
  userName: string;
  userPhone: string | null;
  packages: Array<{
    id: number;
    sessionsTotal: number;
    sessionsUsed: number;
    sessionsRemaining: number;
    pricePerSession: number;
    totalPrice: number;
    trainerSharePct: number;
    startedAt: string;
    expiresAt: string | null;
    status: string;
    sessions: Array<{
      id: number;
      scheduledAt: string;
      completedAt: string | null;
      status: string;
      notes: string | null;
    }>;
  }>;
  recentMeasurements: Array<{
    id: number;
    date: string;
    weight: number | null;
    height: number | null;
    bmi: number | null;
    chest: number | null;
    waist: number | null;
    hips: number | null;
    biceps: number | null;
    notes: string | null;
  }>;
};

export async function getMyClientDetail(
  trainerId: number,
  userId: number
): Promise<TrainerClientDetail | null> {
  // First verify this user has at least one package with this trainer.
  const packages = await prisma.ptPackage.findMany({
    where: { userId, trainerId },
    include: {
      sessions: { orderBy: { scheduledAt: "desc" } },
      user: {
        select: { id: true, firstname: true, lastname: true, phone: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  if (packages.length === 0) {
    return null;
  }

  const user = packages[0].user;

  const measurements = await prisma.bodyMeasurement.findMany({
    where: { userId },
    orderBy: { date: "desc" },
    take: 6,
  });

  return {
    userId: user.id,
    userName: `${user.firstname} ${user.lastname}`,
    userPhone: user.phone,
    packages: packages.map((p) => ({
      id: p.id,
      sessionsTotal: p.sessionsTotal,
      sessionsUsed: p.sessionsUsed,
      sessionsRemaining: p.sessionsTotal - p.sessionsUsed,
      pricePerSession: Number(p.pricePerSession),
      totalPrice: Number(p.totalPrice),
      trainerSharePct: Number(p.trainerSharePct),
      startedAt: p.startedAt.toISOString(),
      expiresAt: p.expiresAt?.toISOString() ?? null,
      status: p.status,
      sessions: p.sessions.map((s) => ({
        id: s.id,
        scheduledAt: s.scheduledAt.toISOString(),
        completedAt: s.completedAt?.toISOString() ?? null,
        status: s.status,
        notes: s.notes,
      })),
    })),
    recentMeasurements: measurements.map((m) => ({
      id: m.id,
      date: m.date.toISOString(),
      weight: m.weight !== null ? Number(m.weight) : null,
      height: m.height !== null ? Number(m.height) : null,
      bmi: m.bmi !== null ? Number(m.bmi) : null,
      chest: m.chest !== null ? Number(m.chest) : null,
      waist: m.waist !== null ? Number(m.waist) : null,
      hips: m.hips !== null ? Number(m.hips) : null,
      biceps: m.biceps !== null ? Number(m.biceps) : null,
      notes: m.notes,
    })),
  };
}

export type TrainerUpcomingSession = {
  id: number;
  scheduledAt: string;
  status: string;
  notes: string | null;
  packageId: number;
  userId: number;
  userName: string;
  userPhone: string | null;
};

export async function getMyUpcomingSessions(
  trainerId: number,
  days: number = 14
): Promise<TrainerUpcomingSession[]> {
  const from = startOfDay(new Date());
  const to = new Date(from);
  to.setDate(to.getDate() + days);

  const sessions = await prisma.ptSession.findMany({
    where: {
      package: { trainerId },
      scheduledAt: { gte: from, lt: to },
      status: { in: ["scheduled", "completed", "no_show", "cancelled"] },
    },
    include: {
      package: {
        include: {
          user: {
            select: { id: true, firstname: true, lastname: true, phone: true },
          },
        },
      },
    },
    orderBy: { scheduledAt: "asc" },
  });

  return sessions.map((s) => ({
    id: s.id,
    scheduledAt: s.scheduledAt.toISOString(),
    status: s.status,
    notes: s.notes,
    packageId: s.packageId,
    userId: s.package.user.id,
    userName: `${s.package.user.firstname} ${s.package.user.lastname}`,
    userPhone: s.package.user.phone,
  }));
}

export async function getMyPayouts(trainerId: number) {
  return listPayoutsForTrainer(trainerId);
}

