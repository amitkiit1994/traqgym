import { prisma } from "@/lib/prisma";
import { resolveSharePct } from "@/lib/services/pt";

type ServiceOk<T> = { success: true } & T;
type ServiceErr = { success: false; error: string };
type ServiceResult<T = object> = ServiceOk<T> | ServiceErr;

// Compute UTC bounds for a given month. month is 1-12.
function monthBounds(month: number, year: number): { start: Date; end: Date } {
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}`);
  }
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
}

export async function computeMonthlyPayout(
  trainerId: number,
  month: number,
  year: number
): Promise<ServiceResult<{ payoutId: number }>> {
  try {
    const trainer = await prisma.worker.findUnique({ where: { id: trainerId } });
    if (!trainer) return { success: false, error: "Trainer not found" };

    const { start, end } = monthBounds(month, year);

    // Find all completed sessions in the period for packages owned by this trainer.
    const sessions = await prisma.ptSession.findMany({
      where: {
        status: "completed",
        scheduledAt: { gte: start, lt: end },
        package: { trainerId },
      },
      include: {
        package: {
          select: {
            id: true,
            pricePerSession: true,
            trainerSharePct: true,
          },
        },
      },
    });

    let grossRevenue = 0;
    let trainerShare = 0;
    for (const s of sessions) {
      const price = Number(s.package.pricePerSession);
      grossRevenue += price;
      const pct = resolveSharePct(s.package.trainerSharePct, trainer);
      trainerShare += (price * pct) / 100;
    }
    grossRevenue = Math.round(grossRevenue * 100) / 100;
    trainerShare = Math.round(trainerShare * 100) / 100;
    const gymShare = Math.round((grossRevenue - trainerShare) * 100) / 100;

    const payout = await prisma.trainerPayout.upsert({
      where: {
        trainerId_periodStart_periodEnd: {
          trainerId,
          periodStart: start,
          periodEnd: end,
        },
      },
      update: {
        sessionsCount: sessions.length,
        grossRevenue,
        gymShare,
        trainerShare,
      },
      create: {
        trainerId,
        periodStart: start,
        periodEnd: end,
        sessionsCount: sessions.length,
        grossRevenue,
        gymShare,
        trainerShare,
        status: "pending",
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "trainer_payout_computed",
        status: "success",
        details: JSON.stringify({
          payoutId: payout.id,
          trainerId,
          periodStart: start.toISOString(),
          periodEnd: end.toISOString(),
          sessionsCount: sessions.length,
          grossRevenue,
          gymShare,
          trainerShare,
        }),
        actorType: "system",
      },
    });

    return { success: true, payoutId: payout.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to compute payout",
    };
  }
}

export async function markPayoutPaid(params: {
  payoutId: number;
  paymentMode: string;
  paidAt?: Date;
  markedById: number;
}): Promise<ServiceResult> {
  try {
    const payout = await prisma.trainerPayout.findUnique({
      where: { id: params.payoutId },
    });
    if (!payout) return { success: false, error: "Payout not found" };
    if (payout.status !== "pending") {
      return { success: false, error: `Payout is already ${payout.status}` };
    }

    const claimed = await prisma.$transaction(async (tx) => {
      // Conditional update: only flips a payout that hasn't already been paid.
      // count===0 means another caller won the race — reject this attempt so
      // we don't double-pay (or double-audit) the trainer.
      const update = await tx.trainerPayout.updateMany({
        where: { id: params.payoutId, paidAt: null, status: "pending" },
        data: {
          status: "paid",
          paidAt: params.paidAt ?? new Date(),
          paymentMode: params.paymentMode,
        },
      });

      if (update.count === 0) {
        return false;
      }

      await tx.auditLog.create({
        data: {
          action: "trainer_payout_paid",
          status: "success",
          details: JSON.stringify({
            payoutId: params.payoutId,
            trainerId: payout.trainerId,
            amount: Number(payout.trainerShare),
            paymentMode: params.paymentMode,
          }),
          actorId: params.markedById,
          actorType: "worker",
        },
      });

      return true;
    });

    if (!claimed) {
      return { success: false, error: "Payout has already been paid" };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to mark payout paid",
    };
  }
}

export async function listPendingPayouts(opts?: { trainerId?: number }) {
  const where: Record<string, unknown> = { status: "pending" };
  if (opts?.trainerId) where.trainerId = opts.trainerId;

  const payouts = await prisma.trainerPayout.findMany({
    where,
    include: {
      trainer: {
        select: { id: true, firstname: true, lastname: true, role: true },
      },
    },
    orderBy: [{ periodStart: "desc" }, { trainerId: "asc" }],
  });

  return payouts.map(serializePayout);
}

export async function listPayoutsForTrainer(trainerId: number) {
  const payouts = await prisma.trainerPayout.findMany({
    where: { trainerId },
    orderBy: { periodStart: "desc" },
  });
  return payouts.map((p) => ({
    id: p.id,
    trainerId: p.trainerId,
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd.toISOString(),
    sessionsCount: p.sessionsCount,
    grossRevenue: Number(p.grossRevenue),
    gymShare: Number(p.gymShare),
    trainerShare: Number(p.trainerShare),
    paidAt: p.paidAt?.toISOString() ?? null,
    paymentMode: p.paymentMode,
    status: p.status,
  }));
}

function serializePayout(p: {
  id: number;
  trainerId: number;
  periodStart: Date;
  periodEnd: Date;
  sessionsCount: number;
  grossRevenue: { toString(): string };
  gymShare: { toString(): string };
  trainerShare: { toString(): string };
  paidAt: Date | null;
  paymentMode: string | null;
  status: string;
  trainer: { firstname: string; lastname: string; role: string };
}) {
  return {
    id: p.id,
    trainerId: p.trainerId,
    trainerName: `${p.trainer.firstname} ${p.trainer.lastname}`,
    trainerRole: p.trainer.role,
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd.toISOString(),
    sessionsCount: p.sessionsCount,
    grossRevenue: Number(p.grossRevenue),
    gymShare: Number(p.gymShare),
    trainerShare: Number(p.trainerShare),
    paidAt: p.paidAt?.toISOString() ?? null,
    paymentMode: p.paymentMode,
    status: p.status,
  };
}
