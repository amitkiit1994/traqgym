import { prisma } from "@/lib/prisma";

export async function recordPartialPayment(params: {
  ticketId: number;
  amount: number;
  paymentMode: string;
  upiReference?: string;
  collectedById: number;
}) {
  const ticket = await prisma.memberTicket.findUnique({
    where: { id: params.ticketId },
    include: { plan: true, user: true },
  });

  if (!ticket) return { success: false, error: "Ticket not found" };
  if (Number(ticket.balanceDue) <= 0) return { success: false, error: "No balance due on this ticket" };
  if (params.amount <= 0) return { success: false, error: "Amount must be positive" };
  if (params.amount > Number(ticket.balanceDue)) {
    return { success: false, error: `Amount exceeds balance due (${ticket.balanceDue})` };
  }

  const result = await prisma.$transaction(async (tx) => {
    const newAmountPaid = Number(ticket.amountPaid) + params.amount;
    const newBalanceDue = Number(ticket.balanceDue) - params.amount;
    const isFullyPaid = newBalanceDue <= 0;

    // Update ticket balance
    await tx.memberTicket.update({
      where: { id: params.ticketId },
      data: {
        amountPaid: newAmountPaid,
        balanceDue: Math.max(0, newBalanceDue),
      },
    });

    // Create payment record
    const payment = await tx.payment.create({
      data: {
        userId: ticket.userId,
        memberTicketId: params.ticketId,
        locationId: ticket.locationId,
        amount: params.amount,
        paymentMode: params.paymentMode,
        upiReference: params.upiReference ?? null,
        collectedById: params.collectedById,
        paymentStatus: isFullyPaid ? "full" : "partial",
        newExpiryDate: ticket.expireDate,
      },
    });

    // Create audit log
    await tx.auditLog.create({
      data: {
        action: "partial_payment",
        status: "success",
        details: JSON.stringify({
          ticketId: params.ticketId,
          userId: ticket.userId,
          amount: params.amount,
          previousPaid: Number(ticket.amountPaid),
          newPaid: newAmountPaid,
          remainingBalance: Math.max(0, newBalanceDue),
          isFullyPaid,
        }),
        actorId: params.collectedById,
        actorType: "worker",
      },
    });

    return { payment, newBalanceDue: Math.max(0, newBalanceDue), isFullyPaid };
  });

  return {
    success: true,
    paymentId: result.payment.id,
    newBalanceDue: result.newBalanceDue,
    isFullyPaid: result.isFullyPaid,
  };
}

export async function getBalanceDueReport(locationId?: number) {
  const where: Record<string, unknown> = {
    balanceDue: { gt: 0 },
  };
  if (locationId) where.locationId = locationId;

  const tickets = await prisma.memberTicket.findMany({
    where,
    include: {
      user: { select: { id: true, firstname: true, lastname: true, phone: true } },
      plan: { select: { name: true } },
    },
    orderBy: { balanceDue: "desc" },
  });

  return tickets.map((t) => ({
    userId: t.user.id,
    memberName: `${t.user.firstname} ${t.user.lastname}`,
    phone: t.user.phone || "-",
    planName: t.plan.name,
    ticketId: t.id,
    totalAmount: Number(t.totalAmount),
    amountPaid: Number(t.amountPaid),
    balanceDue: Number(t.balanceDue),
    dueDate: t.dueDate?.toISOString() ?? null,
    expireDate: t.expireDate.toISOString(),
  }));
}

export async function getMemberBalance(userId: number) {
  const tickets = await prisma.memberTicket.findMany({
    where: { userId, balanceDue: { gt: 0 } },
    include: { plan: { select: { name: true } } },
    orderBy: { buyDate: "desc" },
  });

  const totalDue = tickets.reduce((sum, t) => sum + Number(t.balanceDue), 0);

  return {
    totalBalanceDue: totalDue,
    tickets: tickets.map((t) => ({
      ticketId: t.id,
      planName: t.plan.name,
      totalAmount: t.totalAmount,
      amountPaid: t.amountPaid,
      balanceDue: t.balanceDue,
      dueDate: t.dueDate?.toISOString() ?? null,
    })),
  };
}
