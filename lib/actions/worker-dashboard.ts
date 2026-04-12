"use server";

import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/auth-guard";

function todayDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export async function getMyDashboard(workerId: number, locationId?: number) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const today = todayDate();
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // My attendance today
  const todayAttendance = await prisma.attendanceLog.findFirst({
    where: {
      workerId,
      attendanceDate: today,
      ...(locationId ? { locationId } : {}),
    },
  });

  // My collections today
  const todayPayments = await prisma.payment.findMany({
    where: {
      collectedById: workerId,
      createdAt: { gte: today },
      ...(locationId ? { locationId } : {}),
    },
  });

  const collectionsToday = {
    total: todayPayments.reduce((sum, p) => sum + Number(p.amount), 0),
    count: todayPayments.length,
  };

  // My collections this month
  const monthPayments = await prisma.payment.findMany({
    where: {
      collectedById: workerId,
      createdAt: { gte: monthStart },
      ...(locationId ? { locationId } : {}),
    },
  });

  const collectionsMonth = {
    total: monthPayments.reduce((sum, p) => sum + Number(p.amount), 0),
    count: monthPayments.length,
  };

  // Recent collections (last 10)
  const recentPayments = await prisma.payment.findMany({
    where: {
      collectedById: workerId,
      ...(locationId ? { locationId } : {}),
    },
    include: {
      user: { select: { firstname: true, lastname: true } },
      memberTicket: {
        include: { plan: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const recentCollections = recentPayments.map((p) => ({
    id: p.id,
    memberName: `${p.user.firstname} ${p.user.lastname}`,
    planName: p.memberTicket.plan.name,
    amount: Number(p.amount),
    paymentMode: p.paymentMode,
    date: p.createdAt.toISOString(),
  }));

  // Leave balance this year
  const leaves = await prisma.leaveRequest.findMany({
    where: {
      workerId,
      startDate: { gte: yearStart },
    },
  });

  const leaveBalance = {
    pending: leaves.filter((l) => l.status === "pending").length,
    approved: leaves.filter((l) => l.status === "approved").length,
    rejected: leaves.filter((l) => l.status === "rejected").length,
    total: leaves.length,
  };

  return {
    attendance: todayAttendance
      ? {
          id: todayAttendance.id,
          checkIn: todayAttendance.checkIn.toISOString(),
          checkOut: todayAttendance.checkOut?.toISOString() ?? null,
        }
      : null,
    collectionsToday,
    collectionsMonth,
    recentCollections,
    leaveBalance,
  };
}
