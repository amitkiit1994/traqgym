import { prisma } from "@/lib/prisma";
import { computeGstSplitInclusive, getGymGstRate } from "./tax";

export async function recordPartialPayment(params: {
  ticketId: number;
  amount: number;
  paymentMode: string;
  upiReference?: string;
  collectedById: number;
}) {
  if (params.amount <= 0) return { success: false, error: "Amount must be positive" };

  // Resolve GST rate outside the txn — read-mostly setting, no need to refetch
  // on every retry. Used to populate the Payment row's tax breakdown.
  const gymGstRate = await getGymGstRate();
  const gstSplit = computeGstSplitInclusive(params.amount, gymGstRate);

  const result = await prisma.$transaction(async (tx) => {
    // Read ticket inside the transaction so the validation snapshot matches the writes,
    // closing the race window where two concurrent payments both pass the balance check.
    const ticket = await tx.memberTicket.findUnique({
      where: { id: params.ticketId },
      include: { plan: true, user: true },
    });

    if (!ticket) return { error: "Ticket not found" as const };
    if (Number(ticket.balanceDue) <= 0) return { error: "No balance due on this ticket" as const };
    if (params.amount > Number(ticket.balanceDue)) {
      return { error: `Amount exceeds balance due (${ticket.balanceDue})` as const };
    }

    const newAmountPaid = Number(ticket.amountPaid) + params.amount;
    const newBalanceDue = Number(ticket.balanceDue) - params.amount;
    const isFullyPaid = newBalanceDue <= 0;

    // Atomic compare-and-swap: only succeed if the balance/paid we read are
    // still the current values. Under READ COMMITTED two concurrent partial
    // payments could both see the same balance snapshot and double-credit;
    // updateMany() with the expected values in the WHERE clause makes the
    // database enforce optimistic locking. count===0 means another writer
    // beat us — reject and let the caller retry on a fresh snapshot.
    const updated = await tx.memberTicket.updateMany({
      where: {
        id: params.ticketId,
        amountPaid: ticket.amountPaid,
        balanceDue: ticket.balanceDue,
      },
      data: {
        amountPaid: newAmountPaid,
        balanceDue: Math.max(0, newBalanceDue),
      },
    });
    if (updated.count === 0) {
      return { error: "Ticket was modified concurrently — please retry" as const };
    }

    // Create payment record. GST split (base + rate + tax) is populated so
    // Tally / GSTR-1 see the correct breakdown — every partial collection is
    // also a taxable supply under GST inclusive pricing.
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
        baseAmount: gstSplit.baseAmount,
        taxRate: gstSplit.taxRate,
        taxAmount: gstSplit.taxAmount,
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

  if ("error" in result) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    paymentId: result.payment.id,
    newBalanceDue: result.newBalanceDue,
    isFullyPaid: result.isFullyPaid,
  };
}

export async function getBalanceDueReport(filters?: {
  locationId?: number;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  status?: "active" | "all";
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    balanceDue: { gt: 0 },
  };
  // Default to active-only so the page matches the sidebar badge and the owner
  // doesn't chase dues on cancelled/expired tickets that are uncollectible.
  const statusFilter = filters?.status ?? "active";
  if (statusFilter === "active") where.status = "active";
  if (filters?.locationId) where.locationId = filters.locationId;

  if (filters?.search) {
    const q = filters.search.trim();
    if (q) {
      where.user = {
        OR: [
          { firstname: { contains: q, mode: "insensitive" } },
          { lastname: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ],
      };
    }
  }

  const sortField = filters?.sortBy || "balanceDue";
  const sortDir = filters?.sortOrder || "desc";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any;
  if (sortField === "memberName") {
    orderBy = { user: { firstname: sortDir } };
  } else if (sortField === "balanceDue" || sortField === "totalAmount" || sortField === "dueDate" || sortField === "expireDate") {
    orderBy = { [sortField]: sortDir };
  } else {
    orderBy = { balanceDue: "desc" };
  }

  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 25;

  const [tickets, total, aggregate] = await Promise.all([
    prisma.memberTicket.findMany({
      where,
      include: {
        user: { select: { id: true, firstname: true, lastname: true, phone: true } },
        plan: { select: { name: true } },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.memberTicket.count({ where }),
    prisma.memberTicket.aggregate({
      where,
      _sum: { balanceDue: true },
    }),
  ]);

  const data = tickets.map((t) => ({
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

  const totalDue = aggregate._sum.balanceDue?.toNumber() ?? 0;

  return { data, total, totalDue };
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
