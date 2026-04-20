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

  // R02 fix: BOTH the installment fetch and the ticket fetch must happen INSIDE
  // the transaction. The previous code read installment + ticket OUTSIDE the
  // txn, then computed `newBalanceDue = ticket.balanceDue - paidAmount` against
  // the stale snapshot, so two concurrent installment payments would each
  // double-debit balanceDue. We now use a conditional update on
  // PaymentInstallment.paidAmount (compare-and-set) so a concurrent writer is
  // detected; and we recompute balanceDue from a transactionally-fresh ticket
  // row using a relative decrement to avoid stale-read overwrites.
  try {
    const result = await prisma.$transaction(async (tx) => {
      const installment = await tx.paymentInstallment.findUnique({
        where: { id: params.installmentId },
        include: {
          schedule: {
            include: {
              memberTicket: true,
            },
          },
        },
      });
      if (!installment) {
        throw new Error("Installment not found");
      }
      if (installment.status === "paid") {
        throw new Error("Installment already paid");
      }
      if (installment.status === "waived") {
        throw new Error("Installment is waived");
      }

      const priorPaidAmount = Number(installment.paidAmount);
      const installmentAmount = Number(installment.amount);
      const remainingOnInstallment = installmentAmount - priorPaidAmount;
      if (params.paidAmount > remainingOnInstallment + 0.01) {
        throw new Error(
          `Amount exceeds installment balance (${remainingOnInstallment})`
        );
      }

      // Fetch the ticket fresh inside the txn — do NOT trust the value embedded
      // via the include above (Prisma resolves includes against the same
      // snapshot, but for the balance update we want a single canonical fresh
      // row before computing newBalanceDue and we use a relative decrement to
      // be doubly safe).
      const ticket = await tx.memberTicket.findUnique({
        where: { id: installment.schedule.memberTicketId },
      });
      if (!ticket) {
        throw new Error("Member ticket not found");
      }
      const ticketBalance = Number(ticket.balanceDue);
      if (params.paidAmount > ticketBalance + 0.01) {
        throw new Error(
          `Amount exceeds ticket balance due (${ticketBalance})`
        );
      }

      const newPaidOnInstallment = priorPaidAmount + params.paidAmount;
      const installmentFullyPaid =
        newPaidOnInstallment >= installmentAmount - 0.01;

      // Create payment row first so we can attach paymentId to the installment.
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

      // Conditional update: only succeed if paidAmount still matches the value
      // we read above. If a concurrent writer has already incremented it,
      // updateMany returns count===0 and we abort the txn with a clear error.
      const installmentUpdate = await tx.paymentInstallment.updateMany({
        where: {
          id: installment.id,
          paidAmount: priorPaidAmount,
        },
        data: {
          paidAmount: newPaidOnInstallment,
          paidAt: installmentFullyPaid ? new Date() : installment.paidAt,
          paymentId: payment.id,
          status: installmentFullyPaid ? "paid" : installment.status,
        },
      });
      if (installmentUpdate.count !== 1) {
        throw new Error(
          "Installment was modified concurrently; please retry"
        );
      }

      // Compute newBalanceDue using a relative decrement on the fresh row.
      // Using `decrement` rather than absolute set avoids overwriting any
      // concurrent legitimate balance change.
      const updatedTicket = await tx.memberTicket.update({
        where: { id: ticket.id },
        data: {
          amountPaid: { increment: params.paidAmount },
          balanceDue: { decrement: params.paidAmount },
        },
      });

      // Re-fetch the schedule's installments now that we've written, so nextDue
      // and the schedule completion check both reflect the post-write state.
      const allInstallments = await tx.paymentInstallment.findMany({
        where: { scheduleId: installment.scheduleId },
      });

      const otherInstallments = allInstallments
        .filter(
          (i) =>
            i.id !== installment.id &&
            i.status !== "paid" &&
            i.status !== "waived"
        )
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
      const nextDue = otherInstallments[0]?.dueDate ?? null;

      // Apply nextDue separately (and clamp balanceDue at 0 if the relative
      // decrement somehow took it negative — defensive only).
      const balanceDueClamped = Number(updatedTicket.balanceDue) < 0 ? 0 : null;
      if (nextDue !== updatedTicket.dueDate || balanceDueClamped !== null) {
        await tx.memberTicket.update({
          where: { id: ticket.id },
          data: {
            dueDate: nextDue,
            ...(balanceDueClamped !== null
              ? { balanceDue: balanceDueClamped }
              : {}),
          },
        });
      }

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
            priorPaidAmount,
            newPaidOnInstallment,
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
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Failed to record installment payment",
    };
  }
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
    // Defensive: an installment whose parent schedule is cancelled but the
    // installment itself is still "pending" (legacy bug or partial state)
    // would otherwise leak through. Both filters are required.
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
    // Mark unpaid installments as cancelled too — keeps reminder cron + UI
    // queries clean even if downstream code forgets to filter by parent
    // schedule status. Idempotent via status guard.
    await tx.paymentInstallment.updateMany({
      where: {
        scheduleId,
        status: { in: ["pending", "overdue"] },
      },
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
