import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";
import type { Prisma } from "@prisma/client";

type ScheduleResult =
  | { success: true; scheduleId: number }
  | { success: false; error: string };

type RecordPaymentResult =
  | { success: true; paymentId: number; isFullyPaid: boolean }
  | { success: false; error: string };

export async function createSchedule(params: {
  memberTicketId: number;
  installments: Array<{ dueDate: Date; amount: number }>;
  createdById: number;
}): Promise<ScheduleResult> {
  if (!params.installments || params.installments.length === 0) {
    return { success: false, error: "At least one installment is required" };
  }

  for (const inst of params.installments) {
    if (!(inst.dueDate instanceof Date) || isNaN(inst.dueDate.getTime())) {
      return { success: false, error: "Invalid due date in installment" };
    }
    if (typeof inst.amount !== "number" || inst.amount <= 0) {
      return { success: false, error: "Installment amount must be positive" };
    }
  }

  const ticket = await prisma.memberTicket.findUnique({
    where: { id: params.memberTicketId },
    include: { paymentSchedule: true },
  });
  if (!ticket) return { success: false, error: "Member ticket not found" };
  if (ticket.paymentSchedule) {
    return { success: false, error: "A payment schedule already exists for this ticket" };
  }

  const totalScheduleAmount = params.installments.reduce((s, i) => s + i.amount, 0);

  // Validate against the ticket. If a totalAmount is set, sum must match it
  // OR match the current balanceDue (e.g., scheduling the remaining balance only).
  // For legacy tickets without totalAmount (e.g. imported from FitnessBoard /
  // E-Gym), fall back to balanceDue so the installment sum is still validated.
  const ticketTotal = ticket.totalAmount != null ? Number(ticket.totalAmount) : null;
  const ticketBalance = Number(ticket.balanceDue);

  if (ticketTotal !== null && ticketTotal > 0) {
    const matchesTotal = Math.abs(totalScheduleAmount - ticketTotal) < 0.01;
    const matchesBalance = ticketBalance > 0 && Math.abs(totalScheduleAmount - ticketBalance) < 0.01;
    if (!matchesTotal && !matchesBalance) {
      return {
        success: false,
        error: `Sum of installments (${totalScheduleAmount}) must equal ticket total (${ticketTotal}) or balance due (${ticketBalance})`,
      };
    }
  } else if (ticketBalance > 0) {
    // Legacy ticket without totalAmount — installments must equal current balance due.
    if (Math.abs(totalScheduleAmount - ticketBalance) >= 0.01) {
      return {
        success: false,
        error: `Sum of installments (${totalScheduleAmount}) must equal ticket balance due (${ticketBalance})`,
      };
    }
  } else {
    return {
      success: false,
      error: "Ticket has no totalAmount or balanceDue — cannot validate installment sum",
    };
  }

  // Sort installments by due date and assign sequence numbers
  const sorted = [...params.installments].sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime()
  );

  const result = await prisma.$transaction(async (tx) => {
    const schedule = await tx.paymentSchedule.create({
      data: {
        memberTicketId: params.memberTicketId,
        totalAmount: totalScheduleAmount,
        status: "active",
        createdById: params.createdById,
        installments: {
          create: sorted.map((inst, idx) => ({
            sequenceNumber: idx + 1,
            dueDate: inst.dueDate,
            amount: inst.amount,
          })),
        },
      },
    });

    // Mark ticket dueDate to next pending installment if not already set
    const firstDue = sorted[0]?.dueDate ?? null;
    if (firstDue && !ticket.dueDate) {
      await tx.memberTicket.update({
        where: { id: params.memberTicketId },
        data: { dueDate: firstDue },
      });
    }

    await tx.auditLog.create({
      data: {
        action: "payment_schedule_create",
        status: "success",
        details: JSON.stringify({
          scheduleId: schedule.id,
          memberTicketId: params.memberTicketId,
          totalAmount: totalScheduleAmount,
          installmentCount: sorted.length,
        }),
        actorId: params.createdById,
        actorType: "worker",
      },
    });

    return schedule;
  });

  return { success: true, scheduleId: result.id };
}

export async function recordInstallmentPayment(params: {
  installmentId: number;
  paidAmount: number;
  paymentMode: string;
  collectedById: number;
  upiReference?: string;
}): Promise<RecordPaymentResult> {
  if (params.paidAmount <= 0) {
    return { success: false, error: "Amount must be positive" };
  }

  const installment = await prisma.paymentInstallment.findUnique({
    where: { id: params.installmentId },
    include: {
      schedule: {
        include: {
          memberTicket: true,
          installments: true,
        },
      },
    },
  });
  if (!installment) return { success: false, error: "Installment not found" };
  if (installment.status === "paid") {
    return { success: false, error: "Installment already paid" };
  }
  if (installment.status === "waived") {
    return { success: false, error: "Installment is waived" };
  }

  const remainingOnInstallment =
    Number(installment.amount) - Number(installment.paidAmount);
  if (params.paidAmount > remainingOnInstallment + 0.01) {
    return {
      success: false,
      error: `Amount exceeds installment balance (${remainingOnInstallment})`,
    };
  }

  const ticket = installment.schedule.memberTicket;
  const ticketBalance = Number(ticket.balanceDue);
  if (params.paidAmount > ticketBalance + 0.01) {
    return {
      success: false,
      error: `Amount exceeds ticket balance due (${ticketBalance})`,
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const newPaidOnInstallment = Number(installment.paidAmount) + params.paidAmount;
    const installmentFullyPaid =
      newPaidOnInstallment >= Number(installment.amount) - 0.01;

    // Create payment row
    const payment = await tx.payment.create({
      data: {
        userId: ticket.userId,
        memberTicketId: ticket.id,
        locationId: ticket.locationId,
        amount: params.paidAmount,
        paymentMode: params.paymentMode,
        upiReference: params.upiReference ?? null,
        collectedById: params.collectedById,
        paymentStatus: "partial",
        newExpiryDate: ticket.expireDate,
        paymentFor: "installment",
      },
    });

    // Update installment
    await tx.paymentInstallment.update({
      where: { id: installment.id },
      data: {
        paidAmount: newPaidOnInstallment,
        paidAt: installmentFullyPaid ? new Date() : installment.paidAt,
        paymentId: payment.id,
        status: installmentFullyPaid ? "paid" : installment.status,
      },
    });

    // Update ticket balance
    const newAmountPaid = Number(ticket.amountPaid) + params.paidAmount;
    const newBalanceDue = Math.max(0, Number(ticket.balanceDue) - params.paidAmount);

    // Find next pending installment for dueDate
    const otherInstallments = installment.schedule.installments
      .filter((i) => i.id !== installment.id && i.status !== "paid" && i.status !== "waived")
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    const nextDue = otherInstallments[0]?.dueDate ?? null;

    await tx.memberTicket.update({
      where: { id: ticket.id },
      data: {
        amountPaid: newAmountPaid,
        balanceDue: newBalanceDue,
        dueDate: nextDue,
      },
    });

    // Check if schedule is complete
    const allInstallments = await tx.paymentInstallment.findMany({
      where: { scheduleId: installment.scheduleId },
    });
    const allDone = allInstallments.every(
      (i) => i.status === "paid" || i.status === "waived"
    );
    if (allDone) {
      await tx.paymentSchedule.update({
        where: { id: installment.scheduleId },
        data: { status: "completed" },
      });
    }

    await tx.auditLog.create({
      data: {
        action: "installment_payment",
        status: "success",
        details: JSON.stringify({
          installmentId: installment.id,
          scheduleId: installment.scheduleId,
          ticketId: ticket.id,
          amount: params.paidAmount,
          installmentFullyPaid,
          scheduleCompleted: allDone,
        }),
        actorId: params.collectedById,
        actorType: "worker",
      },
    });

    return { payment, installmentFullyPaid };
  });

  return {
    success: true,
    paymentId: result.payment.id,
    isFullyPaid: result.installmentFullyPaid,
  };
}

export async function getOverdueInstallments(opts?: {
  daysAhead?: number;
  locationId?: number;
}) {
  const today = todayIST();
  const cutoff = new Date(today);
  if (opts?.daysAhead && opts.daysAhead > 0) {
    cutoff.setDate(cutoff.getDate() + opts.daysAhead);
  }

  const where: Prisma.PaymentInstallmentWhereInput = {
    status: { in: ["pending", "overdue"] },
    dueDate: { lte: cutoff },
    schedule: {
      status: "active",
      ...(opts?.locationId
        ? { memberTicket: { locationId: opts.locationId } }
        : {}),
    },
  };

  const installments = await prisma.paymentInstallment.findMany({
    where,
    orderBy: { dueDate: "asc" },
    include: {
      schedule: {
        include: {
          memberTicket: {
            include: {
              user: {
                select: { id: true, firstname: true, lastname: true, phone: true, email: true },
              },
              plan: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  return installments.map((i) => ({
    installmentId: i.id,
    scheduleId: i.scheduleId,
    sequenceNumber: i.sequenceNumber,
    dueDate: i.dueDate,
    amount: Number(i.amount),
    paidAmount: Number(i.paidAmount),
    status: i.status,
    reminderSentAt: i.reminderSentAt,
    isOverdue: i.dueDate < today,
    user: i.schedule.memberTicket.user,
    planName: i.schedule.memberTicket.plan.name,
    ticketId: i.schedule.memberTicketId,
  }));
}

export async function getScheduleForTicket(memberTicketId: number) {
  const schedule = await prisma.paymentSchedule.findUnique({
    where: { memberTicketId },
    include: {
      installments: {
        orderBy: { sequenceNumber: "asc" },
        include: {
          payment: {
            select: { id: true, paymentMode: true, createdAt: true, amount: true },
          },
        },
      },
    },
  });
  if (!schedule) return null;

  const today = todayIST();
  return {
    id: schedule.id,
    memberTicketId: schedule.memberTicketId,
    totalAmount: Number(schedule.totalAmount),
    status: schedule.status,
    createdAt: schedule.createdAt,
    installments: schedule.installments.map((i) => ({
      id: i.id,
      sequenceNumber: i.sequenceNumber,
      dueDate: i.dueDate,
      amount: Number(i.amount),
      paidAmount: Number(i.paidAmount),
      paidAt: i.paidAt,
      status: i.status,
      isOverdue: i.status !== "paid" && i.status !== "waived" && i.dueDate < today,
      reminderSentAt: i.reminderSentAt,
      payment: i.payment
        ? {
            id: i.payment.id,
            paymentMode: i.payment.paymentMode,
            createdAt: i.payment.createdAt,
            amount: Number(i.payment.amount),
          }
        : null,
    })),
  };
}

export async function listSchedules(opts?: {
  status?: string;
  locationId?: number;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = opts?.page ?? 1;
  const pageSize = opts?.pageSize ?? 25;

  const memberTicketFilter: Prisma.MemberTicketWhereInput = {};
  if (opts?.locationId) memberTicketFilter.locationId = opts.locationId;
  if (opts?.search) {
    const q = opts.search.trim();
    if (q) {
      memberTicketFilter.user = {
        OR: [
          { firstname: { contains: q, mode: "insensitive" } },
          { lastname: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
        ],
      };
    }
  }

  const where: Prisma.PaymentScheduleWhereInput = {};
  if (opts?.status && opts.status !== "all") where.status = opts.status;
  if (Object.keys(memberTicketFilter).length > 0) {
    where.memberTicket = memberTicketFilter;
  }

  const [schedules, total] = await Promise.all([
    prisma.paymentSchedule.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        memberTicket: {
          include: {
            user: {
              select: { id: true, firstname: true, lastname: true, phone: true },
            },
            plan: { select: { name: true } },
          },
        },
        installments: {
          orderBy: { sequenceNumber: "asc" },
        },
      },
    }),
    prisma.paymentSchedule.count({ where }),
  ]);

  const today = todayIST();
  const data = schedules.map((s) => {
    const paid = s.installments.reduce((acc, i) => acc + Number(i.paidAmount), 0);
    const nextPending = s.installments.find(
      (i) => i.status !== "paid" && i.status !== "waived"
    );
    const overdueCount = s.installments.filter(
      (i) => i.status !== "paid" && i.status !== "waived" && i.dueDate < today
    ).length;

    return {
      id: s.id,
      memberTicketId: s.memberTicketId,
      memberId: s.memberTicket.user.id,
      memberName: `${s.memberTicket.user.firstname} ${s.memberTicket.user.lastname}`,
      phone: s.memberTicket.user.phone,
      planName: s.memberTicket.plan.name,
      totalAmount: Number(s.totalAmount),
      paidSoFar: paid,
      remaining: Number(s.totalAmount) - paid,
      installmentCount: s.installments.length,
      nextDueDate: nextPending?.dueDate ?? null,
      nextDueAmount: nextPending ? Number(nextPending.amount) - Number(nextPending.paidAmount) : null,
      overdueCount,
      status: s.status,
      createdAt: s.createdAt,
    };
  });

  return { data, total };
}

export async function cancelSchedule(
  scheduleId: number,
  reason: string,
  cancelledById: number
): Promise<{ success: true } | { success: false; error: string }> {
  const schedule = await prisma.paymentSchedule.findUnique({
    where: { id: scheduleId },
  });
  if (!schedule) return { success: false, error: "Schedule not found" };
  if (schedule.status !== "active") {
    return { success: false, error: `Schedule is already ${schedule.status}` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.paymentSchedule.update({
      where: { id: scheduleId },
      data: { status: "cancelled" },
    });
    await tx.auditLog.create({
      data: {
        action: "payment_schedule_cancel",
        status: "success",
        details: JSON.stringify({ scheduleId, reason }),
        actorId: cancelledById,
        actorType: "worker",
      },
    });
  });

  return { success: true };
}

export async function markReminderSent(installmentIds: number[]) {
  if (installmentIds.length === 0) return;
  await prisma.paymentInstallment.updateMany({
    where: { id: { in: installmentIds } },
    data: { reminderSentAt: new Date() },
  });
}
