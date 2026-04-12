"use server";

import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/auth-guard";

type FeedItem = {
  id: string;
  type: string;
  message: string;
  timestamp: string;
};

export async function getActivityFeed(): Promise<FeedItem[]> {
  try { await requireWorker(); } catch { return []; }
  const [auditLogs, attendanceLogs, payments] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.attendanceLog.findMany({
      where: { userId: { not: null } },
      include: {
        user: { select: { firstname: true, lastname: true } },
        location: { select: { name: true } },
      },
      orderBy: { checkIn: "desc" },
      take: 20,
    }),
    prisma.payment.findMany({
      include: {
        user: { select: { firstname: true, lastname: true } },
        memberTicket: { include: { plan: { select: { name: true } } } },
        collectedBy: { select: { firstname: true, lastname: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const items: FeedItem[] = [];

  for (const log of auditLogs) {
    let message = log.action;
    if (log.details) {
      try {
        const d = JSON.parse(log.details);
        if (d.planName && d.userId) {
          message = `${log.action}: ${d.planName} plan`;
        }
      } catch {
        // use raw action
      }
    }
    items.push({
      id: `audit-${log.id}`,
      type: "audit",
      message,
      timestamp: log.createdAt.toISOString(),
    });
  }

  for (const log of attendanceLogs) {
    const name = log.user ? `${log.user.firstname} ${log.user.lastname}` : "Unknown";
    items.push({
      id: `checkin-${log.id}`,
      type: "checkin",
      message: `${name} checked in at ${log.location.name}`,
      timestamp: log.checkIn.toISOString(),
    });
  }

  for (const p of payments) {
    const memberName = `${p.user.firstname} ${p.user.lastname}`;
    const staffName = `${p.collectedBy.firstname} ${p.collectedBy.lastname}`;
    const planName = p.memberTicket.plan.name;
    items.push({
      id: `payment-${p.id}`,
      type: "payment",
      message: `${staffName} renewed ${planName} for ${memberName} (Rs.${Number(p.amount)})`,
      timestamp: p.createdAt.toISOString(),
    });
  }

  // Sort by timestamp desc, take 50
  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return items.slice(0, 50);
}
