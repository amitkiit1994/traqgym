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
}) {
  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.assignedToId) where.assignedToId = filters.assignedToId;
  if (filters?.priority) where.priority = filters.priority;
  if (filters?.locationId) {
    where.user = { locationId: filters.locationId };
  }

  return prisma.paymentFollowup.findMany({
    where,
    include: {
      user: { select: { id: true, firstname: true, lastname: true, phone: true } },
      assignedTo: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: [
      { priority: "asc" },
      { dueDate: "asc" },
    ],
  });
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
  const where: Record<string, unknown> = {
    status: { in: ["pending", "contacted", "promised"] },
    dueDate: { lt: now },
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
