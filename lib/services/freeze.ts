import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";
import { getSetting } from "@/lib/services/settings";

export async function freezeMembership(
  userId: number,
  memberTicketId: number,
  freezeStart: Date,
  freezeEnd: Date,
  reason?: string
) {
  const ticket = await prisma.memberTicket.findUnique({
    where: { id: memberTicketId },
  });
  if (!ticket) return { success: false, error: "Ticket not found" };
  if (ticket.userId !== userId)
    return { success: false, error: "Ticket does not belong to this user" };

  // Validate membership is still active
  const today = todayIST();
  if (ticket.expireDate <= today) {
    return { success: false, error: "Cannot freeze an expired membership" };
  }

  // Validate freeze start is not in the past
  const startDate = new Date(freezeStart);
  startDate.setHours(0, 0, 0, 0);
  if (startDate < today) {
    return { success: false, error: "Freeze start date cannot be in the past" };
  }

  // Check no overlapping active freeze
  const existing = await prisma.membershipFreeze.findFirst({
    where: {
      memberTicketId,
      status: "active",
    },
  });
  if (existing)
    return { success: false, error: "An active freeze already exists for this ticket" };

  // Enforce freeze limits from settings
  const maxFreezesStr = await getSetting("max_freezes_per_membership", "2");
  const maxFreezes = parseInt(maxFreezesStr, 10);
  const maxFreezeDaysStr = await getSetting("max_freeze_days", "30");
  const maxFreezeDays = parseInt(maxFreezeDaysStr, 10);

  const pastFreezes = await prisma.membershipFreeze.findMany({
    where: { memberTicketId, status: { in: ["active", "completed"] } },
  });
  if (pastFreezes.length >= maxFreezes) {
    return { success: false, error: `Maximum of ${maxFreezes} freezes per membership reached` };
  }

  const totalFrozenDays = pastFreezes.reduce((sum, f) => sum + f.daysAdded, 0);

  const diffMs = freezeEnd.getTime() - freezeStart.getTime();
  const daysAdded = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (daysAdded <= 0)
    return { success: false, error: "Freeze end must be after freeze start" };

  if (totalFrozenDays + daysAdded > maxFreezeDays) {
    return { success: false, error: `Freeze would exceed maximum of ${maxFreezeDays} total freeze days` };
  }

  // Extend expiry on the ticket
  const newExpiry = new Date(ticket.expireDate);
  newExpiry.setDate(newExpiry.getDate() + daysAdded);

  const freeze = await prisma.$transaction(async (tx) => {
    await tx.memberTicket.update({
      where: { id: memberTicketId },
      data: { expireDate: newExpiry },
    });

    return tx.membershipFreeze.create({
      data: {
        userId,
        memberTicketId,
        freezeStart,
        freezeEnd,
        reason: reason || null,
        status: "active",
        daysAdded,
        originalExpiry: ticket.expireDate,
      },
    });
  });

  return { success: true, freeze };
}

export async function cancelFreeze(freezeId: number) {
  const freeze = await prisma.membershipFreeze.findUnique({
    where: { id: freezeId },
    include: { memberTicket: true },
  });
  if (!freeze) return { success: false, error: "Freeze not found" };
  if (freeze.status !== "active")
    return { success: false, error: "Freeze is not active" };

  // Revert expiry — use stored originalExpiry if available, fall back to subtraction for legacy records
  const ticket = freeze.memberTicket;
  const revertedExpiry = freeze.originalExpiry
    ? new Date(freeze.originalExpiry)
    : (() => {
        const d = new Date(ticket.expireDate);
        d.setDate(d.getDate() - freeze.daysAdded);
        return d;
      })();

  await prisma.$transaction(async (tx) => {
    await tx.memberTicket.update({
      where: { id: ticket.id },
      data: { expireDate: revertedExpiry },
    });
    await tx.membershipFreeze.update({
      where: { id: freezeId },
      data: { status: "cancelled" },
    });
  });

  return { success: true };
}

export async function getActiveFreezes(userId?: number) {
  const where = userId
    ? { userId, status: "active" }
    : { status: "active" as const };

  return prisma.membershipFreeze.findMany({
    where,
    include: {
      user: { select: { firstname: true, lastname: true } },
      memberTicket: { include: { plan: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}
