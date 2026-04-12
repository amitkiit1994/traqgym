import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

export type AtRiskMember = {
  userId: number;
  name: string;
  phone: string | null;
  reason: string;
  lastCheckIn: Date | null;
  daysInactive: number;
  expiresAt: Date | null;
  planName: string | null;
};

/**
 * Identifies members at risk of churning based on:
 * 1. Active membership but no attendance in X days
 * 2. Membership expiring within 7 days with no renewal conversation
 */
export async function getAtRiskMembers(inactiveDays: number): Promise<AtRiskMember[]> {
  const today = todayIST();

  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - inactiveDays);

  const sevenDaysOut = new Date(today);
  sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);

  // 1. Active members who haven't checked in recently
  const inactiveMembers = await prisma.user.findMany({
    where: {
      memberTickets: {
        some: { expireDate: { gte: today } },
      },
      attendanceLogs: {
        none: { checkIn: { gte: cutoff } },
      },
    },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      phone: true,
      attendanceLogs: {
        orderBy: { checkIn: "desc" },
        take: 1,
        select: { checkIn: true },
      },
      memberTickets: {
        where: { expireDate: { gte: today } },
        orderBy: { expireDate: "asc" },
        take: 1,
        select: { expireDate: true, plan: { select: { name: true } } },
      },
    },
  });

  const results: AtRiskMember[] = [];

  for (const m of inactiveMembers) {
    const lastCheckIn = m.attendanceLogs[0]?.checkIn ?? null;
    const daysInactive = lastCheckIn
      ? Math.floor((today.getTime() - lastCheckIn.getTime()) / 86400000)
      : 999;

    results.push({
      userId: m.id,
      name: `${m.firstname} ${m.lastname}`,
      phone: m.phone,
      reason: lastCheckIn
        ? `No visit in ${daysInactive} days (last: ${lastCheckIn.toISOString().split("T")[0]})`
        : "Never attended",
      lastCheckIn,
      daysInactive,
      expiresAt: m.memberTickets[0]?.expireDate ?? null,
      planName: m.memberTickets[0]?.plan.name ?? null,
    });
  }

  // 2. Expiring soon with no recent interaction
  const expiringSoon = await prisma.memberTicket.findMany({
    where: {
      expireDate: { gte: today, lte: sevenDaysOut },
    },
    include: {
      user: {
        select: {
          id: true,
          firstname: true,
          lastname: true,
          phone: true,
          attendanceLogs: {
            orderBy: { checkIn: "desc" },
            take: 1,
            select: { checkIn: true },
          },
        },
      },
      plan: { select: { name: true } },
    },
  });

  const seenIds = new Set(results.map((r) => r.userId));

  for (const ticket of expiringSoon) {
    if (seenIds.has(ticket.userId)) continue;
    seenIds.add(ticket.userId);

    const daysUntilExpiry = Math.floor(
      (ticket.expireDate.getTime() - today.getTime()) / 86400000
    );

    results.push({
      userId: ticket.userId,
      name: `${ticket.user.firstname} ${ticket.user.lastname}`,
      phone: ticket.user.phone,
      reason: `Membership expires in ${daysUntilExpiry} day(s)`,
      lastCheckIn: ticket.user.attendanceLogs[0]?.checkIn ?? null,
      daysInactive: 0,
      expiresAt: ticket.expireDate,
      planName: ticket.plan.name,
    });
  }

  return results;
}
