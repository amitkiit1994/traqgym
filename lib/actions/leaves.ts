"use server";

import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/auth-guard";
import { getSetting } from "@/lib/services/settings";
import { leaveRequestSchema, reviewLeaveSchema, zodErrors } from "@/lib/validations";

function daysBetween(start: Date, end: Date) {
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

export async function getLeaveBalance(workerId: number) {
  try { await requireWorker(); } catch { return null; }

  const year = new Date().getFullYear();
  const yearStart = new Date(`${year}-01-01`);
  const yearEnd = new Date(`${year}-12-31`);

  const quotas = {
    casual: parseInt(await getSetting("leave_casual_quota", "12"), 10),
    sick: parseInt(await getSetting("leave_sick_quota", "6"), 10),
    personal: parseInt(await getSetting("leave_personal_quota", "3"), 10),
  };

  const approved = await prisma.leaveRequest.findMany({
    where: {
      workerId,
      status: "approved",
      startDate: { gte: yearStart },
      endDate: { lte: yearEnd },
    },
  });

  const used = { casual: 0, sick: 0, personal: 0 };
  for (const r of approved) {
    const days = daysBetween(r.startDate, r.endDate);
    const type = r.leaveType as keyof typeof used;
    if (type in used) used[type] += days;
  }

  return {
    casual: { quota: quotas.casual, used: used.casual, remaining: quotas.casual - used.casual },
    sick: { quota: quotas.sick, used: used.sick, remaining: quotas.sick - used.sick },
    personal: { quota: quotas.personal, used: used.personal, remaining: quotas.personal - used.personal },
  };
}

export async function getLeaveRequests(status?: string) {
  try { await requireWorker(); } catch { return []; }
  const where = status && status !== "all" ? { status } : {};

  const requests = await prisma.leaveRequest.findMany({
    where,
    include: {
      worker: {
        select: { id: true, firstname: true, lastname: true, role: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return requests.map((r) => ({
    id: r.id,
    workerId: r.workerId,
    workerName: `${r.worker.firstname} ${r.worker.lastname}`,
    workerRole: r.worker.role,
    leaveType: r.leaveType,
    startDate: r.startDate.toISOString(),
    endDate: r.endDate.toISOString(),
    reason: r.reason,
    status: r.status,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createLeaveRequest(
  workerId: number,
  data: {
    leaveType: string;
    startDate: string;
    endDate: string;
    reason?: string;
  }
) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  const parsed = leaveRequestSchema.safeParse(data);
  if (!parsed.success) return { success: false, error: Object.values(zodErrors(parsed.error))[0] };

  // Check leave balance
  const balance = await getLeaveBalance(workerId);
  if (balance) {
    const type = data.leaveType as keyof typeof balance;
    if (type in balance) {
      const requestedDays = daysBetween(new Date(data.startDate), new Date(data.endDate));
      if (requestedDays > balance[type].remaining) {
        return {
          success: false,
          error: `Insufficient ${data.leaveType} leave balance. ${balance[type].remaining} day(s) remaining, requested ${requestedDays}.`,
        };
      }
    }
  }

  try {
    const request = await prisma.leaveRequest.create({
      data: {
        workerId,
        leaveType: data.leaveType,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        reason: data.reason || null,
      },
    });

    // In-app notification for admins (fire-and-forget)
    try {
      const { notifyWorkersByRole } = await import("@/lib/services/in-app-notification");
      const worker = await prisma.worker.findUnique({
        where: { id: workerId },
        select: { firstname: true, lastname: true },
      });
      await notifyWorkersByRole({
        role: "admin",
        type: "leave_request",
        title: `Leave request from ${worker?.firstname ?? ""} ${worker?.lastname ?? ""}`.trim(),
        message: `${data.leaveType} leave: ${data.startDate} to ${data.endDate}`,
        link: "/admin/leaves",
      });
    } catch {}

    return { success: true, id: request.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function reviewLeaveRequest(
  id: number,
  status: "approved" | "rejected",
  reviewedBy: number
) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  const parsed = reviewLeaveSchema.safeParse({ id, status, reviewedBy });
  if (!parsed.success) return { success: false, error: Object.values(zodErrors(parsed.error))[0] };
  try {
    await prisma.leaveRequest.update({
      where: { id },
      data: {
        status,
        reviewedBy,
        reviewedAt: new Date(),
      },
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
