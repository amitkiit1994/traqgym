"use server";

import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/auth-guard";
import { revalidatePath, revalidateTag } from "next/cache";
import {
  createSchedule,
  recordInstallmentPayment,
  cancelSchedule,
  listSchedules,
  getScheduleForTicket,
} from "@/lib/services/payment-schedule";

export async function createScheduleAction(params: {
  memberTicketId: number;
  installments: Array<{ dueDate: string; amount: number }>;
}) {
  try {
    const session = await requireWorker();
    const installments = params.installments.map((i) => ({
      dueDate: new Date(i.dueDate),
      amount: Number(i.amount),
    }));
    const result = await createSchedule({
      memberTicketId: params.memberTicketId,
      installments,
      createdById: parseInt(session.user.id, 10),
    });
    if (result.success) {
      revalidatePath("/admin/payment-schedules");
      revalidatePath("/admin/balance-due");
      revalidatePath(`/admin/members`);
      revalidateTag("payments", "max");
    }
    return result;
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }
}

export async function recordInstallmentPaymentAction(params: {
  installmentId: number;
  paidAmount: number;
  paymentMode: string;
  upiReference?: string;
}) {
  try {
    const session = await requireWorker();
    const result = await recordInstallmentPayment({
      ...params,
      collectedById: parseInt(session.user.id, 10),
    });
    if (result.success) {
      revalidatePath("/admin/payment-schedules");
      revalidatePath("/admin/balance-due");
      revalidateTag("payments", "max");
      revalidateTag("dashboard", "max");
      revalidateTag("sidebar-counts", "max");
    }
    return result;
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }
}

export async function cancelScheduleAction(params: {
  scheduleId: number;
  reason: string;
}) {
  try {
    const session = await requireWorker();
    const result = await cancelSchedule(
      params.scheduleId,
      params.reason,
      parseInt(session.user.id, 10)
    );
    if (result.success) {
      revalidatePath("/admin/payment-schedules");
    }
    return result;
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }
}

export async function listSchedulesAction(opts?: {
  status?: string;
  locationId?: number;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  try {
    await requireWorker();
  } catch {
    return { data: [], total: 0 };
  }
  return listSchedules(opts);
}

export async function getScheduleForTicketAction(memberTicketId: number) {
  try {
    await requireWorker();
  } catch {
    return null;
  }
  return getScheduleForTicket(memberTicketId);
}

/**
 * Returns active member tickets that have outstanding balance and no schedule yet.
 * Used to populate the "select ticket" dropdown in the create-schedule dialog.
 */
export async function getSchedulableTicketsAction(opts?: {
  search?: string;
  locationId?: number;
}) {
  try {
    await requireWorker();
  } catch {
    return [];
  }

  const tickets = await prisma.memberTicket.findMany({
    where: {
      status: "active",
      balanceDue: { gt: 0 },
      paymentSchedule: null,
      ...(opts?.locationId ? { locationId: opts.locationId } : {}),
      ...(opts?.search
        ? {
            user: {
              OR: [
                { firstname: { contains: opts.search, mode: "insensitive" } },
                { lastname: { contains: opts.search, mode: "insensitive" } },
                { phone: { contains: opts.search } },
              ],
            },
          }
        : {}),
    },
    include: {
      user: { select: { id: true, firstname: true, lastname: true, phone: true } },
      plan: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return tickets.map((t) => ({
    ticketId: t.id,
    userId: t.user.id,
    memberName: `${t.user.firstname} ${t.user.lastname}`,
    phone: t.user.phone,
    planName: t.plan.name,
    totalAmount: t.totalAmount != null ? Number(t.totalAmount) : null,
    amountPaid: Number(t.amountPaid),
    balanceDue: Number(t.balanceDue),
  }));
}
