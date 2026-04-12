import { prisma } from "@/lib/prisma";
import { renewMembership } from "./renewal";
import { todayIST } from "@/lib/utils/date";

export async function createTrialMembership(params: {
  userId: number;
  planId: number;
  locationId: number;
  createdById: number;
}) {
  // Validate plan exists and is a trial plan
  const plan = await prisma.ticketPlan.findUnique({ where: { id: params.planId } });
  if (!plan) return { success: false, error: "Plan not found" };
  if (!plan.isTrial) return { success: false, error: "Plan is not a trial plan" };
  if (!plan.trialDays) return { success: false, error: "Trial plan has no trialDays set" };
  if (!plan.isActive) return { success: false, error: "Plan is not active" };

  // Validate user exists
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) return { success: false, error: "User not found" };

  // Validate location
  const location = await prisma.location.findUnique({ where: { id: params.locationId } });
  if (!location) return { success: false, error: "Location not found" };
  if (!location.isActive) return { success: false, error: "Location is not active" };

  const today = todayIST();

  // Check: no active trial already
  const existingTrial = await prisma.memberTicket.findFirst({
    where: {
      userId: params.userId,
      isTrial: true,
      status: "active",
      expireDate: { gte: today },
    },
  });
  if (existingTrial) return { success: false, error: "Member already has an active trial" };

  // Check: no active paid plan
  const activePaid = await prisma.memberTicket.findFirst({
    where: {
      userId: params.userId,
      isTrial: false,
      status: "active",
      expireDate: { gte: today },
    },
  });
  if (activePaid) return { success: false, error: "Member already has an active paid plan" };

  // Create trial ticket in transaction
  const result = await prisma.$transaction(async (tx) => {
    const expireDate = new Date(today);
    expireDate.setDate(expireDate.getDate() + plan.trialDays!);

    const ticket = await tx.memberTicket.create({
      data: {
        userId: params.userId,
        planId: params.planId,
        locationId: params.locationId,
        buyDate: new Date(),
        expireDate,
        occasions: plan.occasions,
        isTrial: true,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "trial_created",
        status: "success",
        details: JSON.stringify({
          userId: params.userId,
          planId: params.planId,
          planName: plan.name,
          trialDays: plan.trialDays,
          expireDate: expireDate.toISOString(),
        }),
        actorId: params.createdById,
        actorType: "worker",
      },
    });

    return ticket;
  });

  return {
    success: true,
    ticketId: result.id,
    expireDate: result.expireDate,
  };
}

export async function convertTrial(params: {
  ticketId: number;
  newPlanId: number;
  paymentMode: string;
  amount: number;
  collectedById: number;
  upiReference?: string;
}) {
  // Find trial ticket
  const trial = await prisma.memberTicket.findUnique({
    where: { id: params.ticketId },
    include: { plan: true },
  });
  if (!trial) return { success: false, error: "Trial ticket not found" };
  if (!trial.isTrial) return { success: false, error: "Ticket is not a trial" };
  if (trial.status !== "active") return { success: false, error: "Trial is not active" };

  // Validate new plan
  const newPlan = await prisma.ticketPlan.findUnique({ where: { id: params.newPlanId } });
  if (!newPlan) return { success: false, error: "New plan not found" };
  if (!newPlan.isActive) return { success: false, error: "New plan is not active" };
  if (newPlan.isTrial) return { success: false, error: "Cannot convert to another trial plan" };

  // Expire the trial ticket
  await prisma.memberTicket.update({
    where: { id: params.ticketId },
    data: { status: "expired" },
  });

  // Create new paid membership via renewal service
  const result = await renewMembership({
    userId: trial.userId,
    planId: params.newPlanId,
    locationId: trial.locationId ?? 1,
    paymentMode: params.paymentMode,
    upiReference: params.upiReference,
    collectedById: params.collectedById,
  });

  return {
    success: true,
    trialExpired: true,
    renewal: result,
  };
}

export async function getTrialStats(startDate?: string, endDate?: string) {
  const where: Record<string, unknown> = { isTrial: true };
  if (startDate || endDate) {
    where.buyDate = {
      ...(startDate ? { gte: new Date(startDate) } : {}),
      ...(endDate ? { lte: new Date(endDate) } : {}),
    };
  }

  const today = todayIST();

  const [activeTrials, allTrials] = await Promise.all([
    prisma.memberTicket.count({
      where: { ...where, status: "active", expireDate: { gte: today } },
    }),
    prisma.memberTicket.findMany({
      where,
      select: { id: true, userId: true, status: true, expireDate: true },
    }),
  ]);

  // Expired unconverted: trial expired + user has no paid ticket after trial
  let expiredUnconverted = 0;
  let converted = 0;

  const expiredTrials = allTrials.filter(
    (t) => t.status === "expired" || t.expireDate < today
  );

  for (const trial of expiredTrials) {
    const paidTicket = await prisma.memberTicket.findFirst({
      where: {
        userId: trial.userId,
        isTrial: false,
        buyDate: { gte: trial.expireDate },
      },
    });
    if (paidTicket) {
      converted++;
    } else {
      expiredUnconverted++;
    }
  }

  const total = expiredTrials.length;
  const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

  return {
    success: true,
    activeTrials,
    expiredUnconverted,
    converted,
    conversionRate,
    total: allTrials.length,
  };
}

export async function getActiveTrials(locationId?: number) {
  const today = todayIST();

  const trials = await prisma.memberTicket.findMany({
    where: {
      isTrial: true,
      status: "active",
      expireDate: { gte: today },
      ...(locationId ? { locationId } : {}),
    },
    include: {
      user: { select: { id: true, firstname: true, lastname: true, phone: true, email: true } },
      plan: { select: { id: true, name: true, trialDays: true } },
      location: { select: { id: true, name: true } },
    },
    orderBy: { expireDate: "asc" },
  });

  return {
    success: true,
    trials: trials.map((t) => ({
      ticketId: t.id,
      userId: t.user.id,
      memberName: `${t.user.firstname} ${t.user.lastname}`,
      phone: t.user.phone,
      email: t.user.email,
      planName: t.plan.name,
      trialDays: t.plan.trialDays,
      buyDate: t.buyDate.toISOString(),
      expireDate: t.expireDate.toISOString(),
      daysLeft: Math.ceil((t.expireDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
      locationName: t.location?.name ?? null,
    })),
  };
}
