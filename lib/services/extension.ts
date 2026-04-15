import { prisma } from "@/lib/prisma";

export async function extendMembership(params: {
  userId: number;
  memberTicketId: number;
  daysToAdd: number;
  reason: string;
  createdById: number;
}): Promise<{ success: boolean; extension?: any; error?: string }> {
  const { userId, memberTicketId, daysToAdd, reason, createdById } = params;

  const ticket = await prisma.memberTicket.findUnique({
    where: { id: memberTicketId },
  });
  if (!ticket) return { success: false, error: "Ticket not found" };
  if (ticket.userId !== userId)
    return { success: false, error: "Ticket does not belong to this user" };

  if ((ticket.status ?? "active") !== "active")
    return { success: false, error: "Ticket is not active" };

  if (daysToAdd <= 0)
    return { success: false, error: "Days to add must be positive" };

  const originalExpiry = ticket.expireDate;
  const newExpiry = new Date(originalExpiry);
  newExpiry.setDate(newExpiry.getDate() + daysToAdd);

  const extension = await prisma.$transaction(async (tx) => {
    await tx.memberTicket.update({
      where: { id: memberTicketId },
      data: { expireDate: newExpiry },
    });

    const ext = await tx.membershipExtension.create({
      data: {
        userId,
        memberTicketId,
        daysAdded: daysToAdd,
        reason,
        originalExpiry,
        newExpiry,
        createdById,
      },
    });

    await tx.auditLog.create({
      data: {
        action: "extension_created",
        status: "success",
        details: JSON.stringify({
          userId,
          memberTicketId,
          daysAdded: daysToAdd,
          reason,
          originalExpiry: originalExpiry.toISOString(),
          newExpiry: newExpiry.toISOString(),
        }),
        actorType: "worker",
      },
    });

    return ext;
  });

  return { success: true, extension };
}

export async function getExtensions(userId?: number) {
  const where = userId ? { userId } : {};

  return prisma.membershipExtension.findMany({
    where,
    include: {
      user: { select: { firstname: true, lastname: true } },
      memberTicket: { include: { plan: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}
