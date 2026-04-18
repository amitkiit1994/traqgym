import { prisma } from "@/lib/prisma";

type ServiceOk<T> = { success: true } & T;
type ServiceErr = { success: false; error: string };
type ServiceResult<T = object> = ServiceOk<T> | ServiceErr;

export async function sellPtPackage(params: {
  userId: number;
  trainerId: number;
  sessionsTotal: number;
  pricePerSession: number;
  paymentMode: string;
  paidAmount: number;
  collectedById: number;
  trainerSharePct?: number;
  expiresAt?: Date;
}): Promise<ServiceResult<{ packageId: number }>> {
  try {
    if (!Number.isInteger(params.sessionsTotal) || params.sessionsTotal <= 0) {
      return { success: false, error: "sessionsTotal must be a positive integer" };
    }
    if (params.pricePerSession < 0) {
      return { success: false, error: "pricePerSession must be >= 0" };
    }
    const sharePct = params.trainerSharePct ?? 0;
    if (sharePct < 0 || sharePct > 100) {
      return { success: false, error: "trainerSharePct must be in [0, 100]" };
    }

    // Validate user, trainer, worker
    const [user, trainer, worker] = await Promise.all([
      prisma.user.findUnique({ where: { id: params.userId } }),
      prisma.worker.findUnique({ where: { id: params.trainerId } }),
      prisma.worker.findUnique({ where: { id: params.collectedById } }),
    ]);
    if (!user) return { success: false, error: "Member not found" };
    if (!trainer) return { success: false, error: "Trainer not found" };
    if (!worker) return { success: false, error: "Collector worker not found" };

    const totalPrice = params.sessionsTotal * params.pricePerSession;
    const paidAmount = params.paidAmount;
    const paymentStatus = paidAmount >= totalPrice ? "full" : paidAmount > 0 ? "partial" : "advance";

    // We need a MemberTicket reference for Payment. Find latest active ticket; if none, fall back to most-recent.
    const latestTicket = await prisma.memberTicket.findFirst({
      where: { userId: params.userId },
      orderBy: { expireDate: "desc" },
    });
    if (!latestTicket) {
      return {
        success: false,
        error: "Member must have a membership ticket before purchasing a PT package",
      };
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          userId: params.userId,
          memberTicketId: latestTicket.id,
          locationId: latestTicket.locationId ?? user.locationId ?? null,
          amount: paidAmount,
          paymentMode: params.paymentMode,
          collectedById: params.collectedById,
          trainerId: params.trainerId,
          paymentStatus,
          paymentFor: "pt_package",
        },
      });

      const pkg = await tx.ptPackage.create({
        data: {
          userId: params.userId,
          trainerId: params.trainerId,
          paymentId: payment.id,
          sessionsTotal: params.sessionsTotal,
          pricePerSession: params.pricePerSession,
          totalPrice,
          trainerSharePct: sharePct,
          expiresAt: params.expiresAt ?? null,
          status: "active",
        },
      });

      await tx.auditLog.create({
        data: {
          action: "pt_package_sold",
          status: "success",
          details: JSON.stringify({
            packageId: pkg.id,
            paymentId: payment.id,
            userId: params.userId,
            trainerId: params.trainerId,
            sessionsTotal: params.sessionsTotal,
            pricePerSession: params.pricePerSession,
            totalPrice,
            paidAmount,
            trainerSharePct: sharePct,
          }),
          actorId: params.collectedById,
          actorType: "worker",
        },
      });

      return { packageId: pkg.id };
    });

    return { success: true, packageId: result.packageId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to sell PT package",
    };
  }
}

export async function recordPtSession(params: {
  packageId: number;
  scheduledAt: Date;
  status?: "scheduled" | "completed" | "no_show" | "cancelled";
  notes?: string;
  recordedById: number;
}): Promise<ServiceResult<{ sessionId: number }>> {
  try {
    const pkg = await prisma.ptPackage.findUnique({ where: { id: params.packageId } });
    if (!pkg) return { success: false, error: "PT package not found" };
    if (pkg.status !== "active") {
      return { success: false, error: `Cannot record session for ${pkg.status} package` };
    }

    const status = params.status ?? "scheduled";

    const result = await prisma.$transaction(async (tx) => {
      const session = await tx.ptSession.create({
        data: {
          packageId: params.packageId,
          scheduledAt: params.scheduledAt,
          status,
          notes: params.notes ?? null,
          completedAt: status === "completed" ? new Date() : null,
        },
      });

      let updatedPkg = pkg;
      if (status === "completed") {
        if (pkg.sessionsUsed >= pkg.sessionsTotal) {
          throw new Error("Package has no remaining sessions");
        }
        updatedPkg = await tx.ptPackage.update({
          where: { id: params.packageId },
          data: {
            sessionsUsed: { increment: 1 },
            ...(pkg.sessionsUsed + 1 >= pkg.sessionsTotal
              ? { status: "completed" }
              : {}),
          },
        });
      }

      await tx.auditLog.create({
        data: {
          action: "pt_session_recorded",
          status: "success",
          details: JSON.stringify({
            sessionId: session.id,
            packageId: params.packageId,
            scheduledAt: params.scheduledAt.toISOString(),
            status,
            packageStatus: updatedPkg.status,
          }),
          actorId: params.recordedById,
          actorType: "worker",
        },
      });

      return { sessionId: session.id };
    });

    return { success: true, sessionId: result.sessionId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to record session",
    };
  }
}

export async function completePtSession(params: {
  sessionId: number;
  completedAt?: Date;
  notes?: string;
  recordedById?: number;
}): Promise<ServiceResult> {
  try {
    await prisma.$transaction(async (tx) => {
      // Read fresh state inside the txn to avoid race overshoot.
      const session = await tx.ptSession.findUnique({
        where: { id: params.sessionId },
        include: { package: true },
      });
      if (!session) {
        throw new Error("Session not found");
      }
      if (session.status === "completed") {
        throw new Error("Session already completed");
      }
      if (session.package.status !== "active") {
        throw new Error(`Package is ${session.package.status}`);
      }

      await tx.ptSession.update({
        where: { id: params.sessionId },
        data: {
          status: "completed",
          completedAt: params.completedAt ?? new Date(),
          ...(params.notes !== undefined ? { notes: params.notes } : {}),
        },
      });

      // Conditional update — only increment if we still have remaining sessions.
      // This prevents two concurrent completions from overshooting sessionsTotal.
      const incCount = await tx.ptPackage.updateMany({
        where: {
          id: session.packageId,
          sessionsUsed: { lt: session.package.sessionsTotal },
        },
        data: { sessionsUsed: { increment: 1 } },
      });
      if (incCount.count === 0) {
        throw new Error("Package has no remaining sessions");
      }

      // Read the post-increment value to decide whether to flip status to completed.
      const updatedPkg = await tx.ptPackage.findUnique({
        where: { id: session.packageId },
        select: { sessionsUsed: true, sessionsTotal: true },
      });
      if (updatedPkg && updatedPkg.sessionsUsed >= updatedPkg.sessionsTotal) {
        await tx.ptPackage.update({
          where: { id: session.packageId },
          data: { status: "completed" },
        });
      }

      await tx.auditLog.create({
        data: {
          action: "pt_session_completed",
          status: "success",
          details: JSON.stringify({
            sessionId: params.sessionId,
            packageId: session.packageId,
          }),
          actorId: params.recordedById ?? null,
          actorType: "worker",
        },
      });
    });

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to complete session",
    };
  }
}

export async function getTrainerStats(
  trainerId: number,
  dateRange: { from: Date; to: Date }
) {
  const [trainer, activePackages, sessions, packagesInRange] = await Promise.all([
    prisma.worker.findUnique({ where: { id: trainerId } }),
    prisma.ptPackage.count({
      where: { trainerId, status: "active" },
    }),
    prisma.ptSession.findMany({
      where: {
        package: { trainerId },
        scheduledAt: { gte: dateRange.from, lt: dateRange.to },
      },
      include: { package: true },
    }),
    prisma.ptPackage.findMany({
      where: { trainerId },
      select: { id: true, userId: true },
    }),
  ]);

  if (!trainer) {
    return {
      activePackages: 0,
      totalSessionsThisMonth: 0,
      sessionsByStatus: { scheduled: 0, completed: 0, no_show: 0, cancelled: 0 },
      clientCount: 0,
      revenueGenerated: 0,
      commissionEarned: 0,
    };
  }

  const sessionsByStatus = {
    scheduled: 0,
    completed: 0,
    no_show: 0,
    cancelled: 0,
  };
  let revenueGenerated = 0;
  let commissionEarned = 0;
  for (const s of sessions) {
    if (s.status in sessionsByStatus) {
      sessionsByStatus[s.status as keyof typeof sessionsByStatus]++;
    }
    if (s.status === "completed") {
      const sessionPrice = Number(s.package.pricePerSession);
      revenueGenerated += sessionPrice;
      const sharePct = resolveSharePct(s.package.trainerSharePct, trainer);
      commissionEarned += (sessionPrice * sharePct) / 100;
    }
  }

  const clientCount = new Set(packagesInRange.map((p) => p.userId)).size;

  return {
    activePackages,
    totalSessionsThisMonth: sessions.length,
    sessionsByStatus,
    clientCount,
    revenueGenerated: Math.round(revenueGenerated * 100) / 100,
    commissionEarned: Math.round(commissionEarned * 100) / 100,
  };
}

export async function getMyPtClients(trainerId: number) {
  const packages = await prisma.ptPackage.findMany({
    where: { trainerId, status: "active" },
    include: {
      user: { select: { id: true, firstname: true, lastname: true, phone: true } },
      sessions: {
        orderBy: { scheduledAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return packages.map((p) => ({
    userId: p.userId,
    userName: `${p.user.firstname} ${p.user.lastname}`,
    userPhone: p.user.phone,
    packageId: p.id,
    sessionsTotal: p.sessionsTotal,
    sessionsUsed: p.sessionsUsed,
    sessionsRemaining: p.sessionsTotal - p.sessionsUsed,
    lastSessionAt: p.sessions[0]?.scheduledAt?.toISOString() ?? null,
  }));
}

export async function listPtPackages(opts?: {
  trainerId?: number;
  status?: string;
  locationId?: number;
}) {
  const where: Record<string, unknown> = {};
  if (opts?.trainerId) where.trainerId = opts.trainerId;
  if (opts?.status && opts.status !== "all") where.status = opts.status;
  if (opts?.locationId) {
    where.user = { locationId: opts.locationId };
  }

  const packages = await prisma.ptPackage.findMany({
    where,
    include: {
      user: {
        select: { id: true, firstname: true, lastname: true, phone: true },
      },
      trainer: {
        select: { id: true, firstname: true, lastname: true, role: true },
      },
      payment: {
        select: { id: true, amount: true, paymentStatus: true, paymentMode: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return packages.map((p) => ({
    id: p.id,
    userId: p.userId,
    userName: `${p.user.firstname} ${p.user.lastname}`,
    userPhone: p.user.phone,
    trainerId: p.trainerId,
    trainerName: `${p.trainer.firstname} ${p.trainer.lastname}`,
    sessionsTotal: p.sessionsTotal,
    sessionsUsed: p.sessionsUsed,
    pricePerSession: Number(p.pricePerSession),
    totalPrice: Number(p.totalPrice),
    trainerSharePct: Number(p.trainerSharePct),
    startedAt: p.startedAt.toISOString(),
    expiresAt: p.expiresAt?.toISOString() ?? null,
    status: p.status,
    paymentId: p.paymentId,
    paymentStatus: p.payment?.paymentStatus ?? null,
    paymentMode: p.payment?.paymentMode ?? null,
  }));
}

export async function getPtPackageDetail(packageId: number) {
  const pkg = await prisma.ptPackage.findUnique({
    where: { id: packageId },
    include: {
      user: {
        select: { id: true, firstname: true, lastname: true, phone: true },
      },
      trainer: {
        select: { id: true, firstname: true, lastname: true, role: true },
      },
      sessions: { orderBy: { scheduledAt: "desc" } },
      payment: true,
    },
  });
  if (!pkg) return null;
  return {
    id: pkg.id,
    userId: pkg.userId,
    userName: `${pkg.user.firstname} ${pkg.user.lastname}`,
    userPhone: pkg.user.phone,
    trainerId: pkg.trainerId,
    trainerName: `${pkg.trainer.firstname} ${pkg.trainer.lastname}`,
    sessionsTotal: pkg.sessionsTotal,
    sessionsUsed: pkg.sessionsUsed,
    pricePerSession: Number(pkg.pricePerSession),
    totalPrice: Number(pkg.totalPrice),
    trainerSharePct: Number(pkg.trainerSharePct),
    startedAt: pkg.startedAt.toISOString(),
    expiresAt: pkg.expiresAt?.toISOString() ?? null,
    status: pkg.status,
    sessions: pkg.sessions.map((s) => ({
      id: s.id,
      scheduledAt: s.scheduledAt.toISOString(),
      completedAt: s.completedAt?.toISOString() ?? null,
      status: s.status,
      notes: s.notes,
    })),
  };
}

// Internal helper: resolve effective trainer share percentage from a package
// using precedence: package.trainerSharePct (if > 0) > worker.ownTrainerCutPct (if > 0) > worker.defaultGymCutPct.
// Note: defaultGymCutPct represents the gym's cut for external trainers; we treat ownTrainerCutPct as the
// trainer's share. When neither is configured, we fall back to package.trainerSharePct (which may be 0).
export function resolveSharePct(
  packageTrainerSharePct: { toString(): string } | number,
  trainer: { isExternal?: boolean; ownTrainerCutPct?: { toString(): string } | number; defaultGymCutPct?: { toString(): string } | number }
): number {
  const pkgPct = Number(packageTrainerSharePct);
  if (pkgPct > 0) return pkgPct;
  const own = Number(trainer.ownTrainerCutPct ?? 0);
  if (own > 0) return own;
  const gymCut = Number(trainer.defaultGymCutPct ?? 0);
  // gymCut is the gym's share; trainer's residual is 100 - gymCut, but only meaningful for external trainers
  if (trainer.isExternal && gymCut > 0 && gymCut <= 100) {
    return 100 - gymCut;
  }
  return 0;
}
