import { prisma } from "@/lib/prisma";

export async function createFollowup(data: {
  userId: number;
  memberTicketId?: number;
  amountDue: number;
  dueDate: Date;
  assignedToId?: number;
  priority?: string;
  notes?: string;
}) {
  // Prevent duplicate active followups for same user+ticket
  const existing = await prisma.paymentFollowup.findFirst({
    where: {
      userId: data.userId,
      memberTicketId: data.memberTicketId ?? null,
      status: { notIn: ["resolved", "written_off"] },
    },
  });
  if (existing) {
    return { success: false as const, error: "Active followup already exists for this member/ticket" };
  }

  const followup = await prisma.paymentFollowup.create({
    data: {
      userId: data.userId,
      memberTicketId: data.memberTicketId ?? null,
      amountDue: data.amountDue,
      dueDate: data.dueDate,
      assignedToId: data.assignedToId ?? null,
      priority: data.priority ?? "normal",
      notes: data.notes ?? null,
    },
  });

  return { success: true as const, followup };
}

export async function getFollowups(filters?: {
  status?: string;
  assignedToId?: number;
  priority?: string;
  locationId?: number;
  showArchived?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}) {
  const where: Record<string, unknown> = { amountDue: { gt: 0 } };
  if (filters?.status) where.status = filters.status;
  if (filters?.assignedToId) where.assignedToId = filters.assignedToId;
  if (filters?.priority) where.priority = filters.priority;
  if (filters?.locationId) {
    where.user = { ...(where.user as object || {}), locationId: filters.locationId };
  }

  // Default: scope to last 90 days for actionable statuses (hide ancient dead data)
  if (!filters?.showArchived) {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const activeStatuses = ["pending", "contacted", "promised"];
    const currentStatus = filters?.status;
    if (!currentStatus || activeStatuses.includes(currentStatus)) {
      where.dueDate = { ...(where.dueDate as object || {}), gte: ninetyDaysAgo };
    }
  }

  // Search by member name or phone
  if (filters?.search) {
    const q = filters.search.trim();
    if (q) {
      where.user = {
        ...(where.user as object || {}),
        OR: [
          { firstname: { contains: q, mode: "insensitive" } },
          { lastname: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ],
      };
    }
  }

  // Build orderBy
  const sortField = filters?.sortBy || "dueDate";
  const sortDir = filters?.sortOrder || "asc";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any;
  if (sortField === "memberName") {
    orderBy = { user: { firstname: sortDir } };
  } else if (sortField === "amountDue" || sortField === "dueDate" || sortField === "priority" || sortField === "status" || sortField === "createdAt") {
    orderBy = { [sortField]: sortDir };
  } else {
    orderBy = [{ priority: "asc" }, { dueDate: "asc" }];
  }

  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 25;

  const [items, total, aggregate] = await Promise.all([
    prisma.paymentFollowup.findMany({
      where,
      include: {
        user: { select: { id: true, firstname: true, lastname: true, phone: true } },
        assignedTo: { select: { id: true, firstname: true, lastname: true } },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.paymentFollowup.count({ where }),
    prisma.paymentFollowup.aggregate({
      where,
      _sum: { amountDue: true },
    }),
  ]);

  const totalDue = aggregate._sum.amountDue?.toNumber() ?? 0;

  return { items, total, totalDue };
}

export async function updateFollowup(
  id: number,
  data: {
    status?: string;
    notes?: string;
    nextFollowupAt?: Date;
    lastContactedAt?: Date;
    priority?: string;
  }
) {
  const followup = await prisma.paymentFollowup.findUnique({ where: { id } });
  if (!followup) return { success: false as const, error: "Followup not found" };

  const updateData: Record<string, unknown> = {};
  if (data.status) updateData.status = data.status;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.nextFollowupAt) updateData.nextFollowupAt = data.nextFollowupAt;
  if (data.lastContactedAt) updateData.lastContactedAt = data.lastContactedAt;
  if (data.priority) updateData.priority = data.priority;
  if (data.status === "resolved") updateData.resolvedAt = new Date();

  const updated = await prisma.paymentFollowup.update({
    where: { id },
    data: updateData,
  });

  return { success: true as const, followup: updated };
}

export async function assignFollowup(id: number, workerId: number) {
  const followup = await prisma.paymentFollowup.findUnique({ where: { id } });
  if (!followup) return { success: false as const, error: "Followup not found" };

  const updated = await prisma.paymentFollowup.update({
    where: { id },
    data: { assignedToId: workerId },
  });

  // In-app notification for assigned worker (fire-and-forget)
  try {
    const { notifyWorker } = await import("@/lib/services/in-app-notification");
    await notifyWorker({
      workerId,
      type: "followup_assigned",
      title: `Payment followup assigned`,
      message: `Amount due: ₹${Number(followup.amountDue).toLocaleString("en-IN")}`,
      link: "/admin/followups",
    });
  } catch {}

  return { success: true as const, followup: updated };
}

export async function getOverdueFollowups(locationId?: number) {
  const now = new Date();
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const where: Record<string, unknown> = {
    status: { in: ["pending", "contacted", "promised"] },
    dueDate: { gte: ninetyDaysAgo, lt: now },
    amountDue: { gt: 0 },
  };
  if (locationId) {
    where.user = { locationId };
  }

  return prisma.paymentFollowup.findMany({
    where,
    include: {
      user: { select: { id: true, firstname: true, lastname: true, phone: true } },
      assignedTo: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { dueDate: "asc" },
  });
}

/**
 * Rule-based relevance scoring (0-100).
 * Higher = more actionable / worth pursuing.
 */
export function scoreFollowupRelevance(followup: {
  dueDate: Date;
  amountDue: number | { toNumber?: () => number };
  status: string;
  lastContactedAt: Date | null;
  // Whether the user has an active ticket
  hasActiveTicket?: boolean;
}): number {
  const now = new Date();
  const daysOverdue = Math.floor(
    (now.getTime() - new Date(followup.dueDate).getTime()) / (1000 * 60 * 60 * 24)
  );
  const amount =
    typeof followup.amountDue === "number"
      ? followup.amountDue
      : Number(followup.amountDue);

  let score = 50; // baseline

  // Recency: newer = higher (40% weight, max 40 points)
  if (daysOverdue <= 7) score += 40;
  else if (daysOverdue <= 30) score += 30;
  else if (daysOverdue <= 60) score += 15;
  else if (daysOverdue <= 90) score += 5;
  else score -= 10; // very old = deprioritize

  // Active member boost (+30)
  if (followup.hasActiveTicket) score += 30;

  // Amount: higher balance = slight boost (15% weight)
  if (amount >= 5000) score += 15;
  else if (amount >= 2000) score += 10;
  else if (amount >= 500) score += 5;

  // Contact attempts penalty: contacted but unresolved
  if (followup.status === "contacted" && followup.lastContactedAt) {
    const daysSinceContact = Math.floor(
      (now.getTime() - new Date(followup.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceContact > 30) score -= 15;
    else if (daysSinceContact > 14) score -= 5;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Suggest an action for a followup item (rules-based, no LLM).
 */
export function suggestAction(followup: {
  dueDate: Date;
  amountDue: number | { toNumber?: () => number };
  status: string;
  lastContactedAt: Date | null;
  hasActiveTicket?: boolean;
}): string {
  const now = new Date();
  const daysOverdue = Math.floor(
    (now.getTime() - new Date(followup.dueDate).getTime()) / (1000 * 60 * 60 * 24)
  );
  const amount =
    typeof followup.amountDue === "number"
      ? followup.amountDue
      : Number(followup.amountDue);

  if (daysOverdue > 180 && !followup.hasActiveTicket) {
    return "Write off — member left long ago";
  }

  if (followup.status === "promised") {
    return "Follow up on promise";
  }

  if (followup.hasActiveTicket && daysOverdue <= 7) {
    return "Send payment reminder";
  }

  if (followup.hasActiveTicket && amount >= 3000) {
    return "Priority call — high amount, active member";
  }

  if (followup.status === "contacted" && followup.lastContactedAt) {
    const daysSinceContact = Math.floor(
      (now.getTime() - new Date(followup.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    if (daysSinceContact > 14) {
      return "Re-contact — no response in 2+ weeks";
    }
    return "Wait for response";
  }

  if (daysOverdue > 90) {
    return "Consider writing off";
  }

  return "Contact member";
}

/** Auto-resolve followups when balance is paid in full */
export async function autoResolveFollowup(userId: number, memberTicketId?: number) {
  const where: Record<string, unknown> = {
    userId,
    status: { notIn: ["resolved", "written_off"] },
  };
  if (memberTicketId) where.memberTicketId = memberTicketId;

  await prisma.paymentFollowup.updateMany({
    where,
    data: { status: "resolved", resolvedAt: new Date() },
  });
}
