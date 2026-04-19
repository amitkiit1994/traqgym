"use server";

import { z } from "zod";
import { requireWorker } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  sellPtPackage,
  recordPtSession,
  completePtSession,
  getTrainerStats,
  getMyPtClients,
  listPtPackages,
  getPtPackageDetail,
} from "@/lib/services/pt";

const sellSchema = z.object({
  userId: z.number().int().positive(),
  trainerId: z.number().int().positive(),
  sessionsTotal: z.number().int().positive(),
  pricePerSession: z.number().nonnegative(),
  paymentMode: z.string().min(1),
  paidAmount: z.number().nonnegative(),
  trainerSharePct: z.number().min(0).max(100).optional(),
  expiresAt: z.string().optional(),
});

export async function sellPtPackageAction(input: {
  userId: number;
  trainerId: number;
  sessionsTotal: number;
  pricePerSession: number;
  paymentMode: string;
  paidAmount: number;
  trainerSharePct?: number;
  expiresAt?: string;
}) {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }

  const parsed = sellSchema.safeParse(input);
  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { success: false as const, error: firstError ?? "Invalid input" };
  }

  return sellPtPackage({
    userId: input.userId,
    trainerId: input.trainerId,
    sessionsTotal: input.sessionsTotal,
    pricePerSession: input.pricePerSession,
    paymentMode: input.paymentMode,
    paidAmount: input.paidAmount,
    collectedById: parseInt(session.user.id, 10),
    trainerSharePct: input.trainerSharePct,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
  });
}

const recordSchema = z.object({
  packageId: z.number().int().positive(),
  scheduledAt: z.string().min(1),
  status: z.enum(["scheduled", "completed", "no_show", "cancelled"]).optional(),
  notes: z.string().optional(),
});

export async function recordPtSessionAction(input: {
  packageId: number;
  scheduledAt: string;
  status?: "scheduled" | "completed" | "no_show" | "cancelled";
  notes?: string;
}) {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }

  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { success: false as const, error: firstError ?? "Invalid input" };
  }

  const dt = new Date(input.scheduledAt);
  if (isNaN(dt.getTime())) {
    return { success: false as const, error: "Invalid scheduledAt" };
  }

  // Trainer-ownership enforcement: only the package's trainer (or an admin)
  // may record a session against that package.
  const callerWorkerId = parseInt(session.user.id, 10);
  const isAdmin = session.user.role === "admin";
  if (!isAdmin) {
    const pkg = await prisma.ptPackage.findUnique({
      where: { id: input.packageId },
      select: { trainerId: true },
    });
    if (!pkg) {
      return { success: false as const, error: "PT package not found" };
    }
    if (pkg.trainerId !== callerWorkerId) {
      return { success: false as const, error: "Forbidden" };
    }
  }

  return recordPtSession({
    packageId: input.packageId,
    scheduledAt: dt,
    status: input.status,
    notes: input.notes,
    recordedById: callerWorkerId,
  });
}

export async function completePtSessionAction(sessionId: number, notes?: string) {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }

  // Trainer-ownership enforcement: derive package from the session, then
  // assert caller is the trainer (or an admin).
  const callerWorkerId = parseInt(session.user.id, 10);
  const isAdmin = session.user.role === "admin";
  if (!isAdmin) {
    const ptSession = await prisma.ptSession.findUnique({
      where: { id: sessionId },
      select: { package: { select: { trainerId: true } } },
    });
    if (!ptSession) {
      return { success: false as const, error: "Session not found" };
    }
    if (ptSession.package.trainerId !== callerWorkerId) {
      return { success: false as const, error: "Forbidden" };
    }
  }

  return completePtSession({
    sessionId,
    notes,
    recordedById: callerWorkerId,
  });
}

export async function getTrainerStatsAction(
  trainerId: number,
  fromDate: string,
  toDate: string
) {
  try {
    await requireWorker();
  } catch {
    return null;
  }
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return null;
  return getTrainerStats(trainerId, { from, to });
}

export async function getMyPtClientsAction(_trainerId?: number) {
  // Note: the `_trainerId` param is intentionally IGNORED — we always derive
  // the trainer from the authenticated session to prevent IDOR / one trainer
  // viewing another trainer's clients (S08/S18).
  void _trainerId;
  let session;
  try {
    session = await requireWorker();
  } catch {
    return [];
  }
  const callerWorkerId = parseInt(session.user.id, 10);
  if (!Number.isFinite(callerWorkerId)) {
    return [];
  }
  return getMyPtClients(callerWorkerId);
}

export async function listPtPackagesAction(opts?: {
  trainerId?: number;
  status?: string;
  locationId?: number;
}) {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return [];
  }
  const role = (session.user as { role?: string }).role ?? "staff";
  const callerWorkerId = parseInt(session.user.id, 10);
  // Trainers (non-admin) may only list their own packages.
  if (role !== "admin") {
    if (!Number.isFinite(callerWorkerId)) return [];
    return listPtPackages({ ...opts, trainerId: callerWorkerId });
  }
  return listPtPackages(opts);
}

export async function getPtPackageDetailAction(packageId: number) {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return null;
  }
  const role = (session.user as { role?: string }).role ?? "staff";
  const callerWorkerId = parseInt(session.user.id, 10);
  const detail = await getPtPackageDetail(packageId);
  if (!detail) return null;
  // Non-admins may only read packages they own as the assigned trainer.
  if (role !== "admin" && detail.trainerId !== callerWorkerId) {
    return null;
  }
  return detail;
}

export async function getTrainersAction() {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  return prisma.worker.findMany({
    where: {
      isActive: true,
      OR: [
        { ptPackagesAsTrainer: { some: {} } },
        { trainerPayments: { some: {} } },
      ],
    },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      role: true,
      isExternal: true,
      defaultGymCutPct: true,
      ownTrainerCutPct: true,
    },
    orderBy: { firstname: "asc" },
  }).then((rows) =>
    rows.map((r) => ({
      ...r,
      defaultGymCutPct: Number(r.defaultGymCutPct),
      ownTrainerCutPct: Number(r.ownTrainerCutPct),
    }))
  );
}

export async function searchMembersForPtAction(query: string) {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  if (!query || query.length < 2) return [];
  const q = query.trim();
  return prisma.user.findMany({
    where: {
      OR: [
        { firstname: { contains: q, mode: "insensitive" } },
        { lastname: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    },
    select: { id: true, firstname: true, lastname: true, phone: true },
    take: 10,
  });
}
