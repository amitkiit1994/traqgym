import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

export type UsageSegment = "heavy" | "moderate" | "light";

export type MemberUsageRow = {
  userId: number;
  name: string;
  phone: string;
  plan: string;
  totalVisits: number;
  membershipDays: number;
  usagePercent: number;
  segment: UsageSegment;
};

export type MemberUsageResult = {
  segments: { heavy: number; moderate: number; light: number };
  members: MemberUsageRow[];
};

function getSegment(usagePercent: number): UsageSegment {
  if (usagePercent > 70) return "heavy";
  if (usagePercent >= 30) return "moderate";
  return "light";
}

export async function getMemberUsage(locationId?: number): Promise<MemberUsageResult> {
  const now = todayIST();
  const locFilter: Record<string, unknown> = locationId ? { locationId } : {};

  // Get all users with an active ticket
  const users = await prisma.user.findMany({
    where: {
      ...locFilter,
      memberTickets: {
        some: {
          expireDate: { gte: now },
          status: "active",
        },
      },
    },
    include: {
      memberTickets: {
        where: { expireDate: { gte: now }, status: "active" },
        orderBy: { buyDate: "asc" },
        take: 1,
        include: { plan: { select: { name: true } } },
      },
      _count: {
        select: { attendanceLogs: true },
      },
    },
  });

  const segments = { heavy: 0, moderate: 0, light: 0 };
  const members: MemberUsageRow[] = [];

  for (const u of users) {
    const ticket = u.memberTickets[0];
    if (!ticket) continue;

    const buyDate = new Date(ticket.buyDate);
    const endDate = new Date(ticket.expireDate) < now ? new Date(ticket.expireDate) : now;
    const membershipDays = Math.max(1, Math.ceil((endDate.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24)));

    // Count attendance logs for this user within the ticket period
    const totalVisits = await prisma.attendanceLog.count({
      where: {
        userId: u.id,
        attendanceDate: { gte: buyDate, lte: endDate },
      },
    });

    const usagePercent = Math.round((totalVisits / membershipDays) * 10000) / 100;
    const segment = getSegment(usagePercent);
    segments[segment]++;

    members.push({
      userId: u.id,
      name: `${u.firstname} ${u.lastname}`,
      phone: u.phone ?? "-",
      plan: ticket.plan.name,
      totalVisits,
      membershipDays,
      usagePercent,
      segment,
    });
  }

  // Sort by usage ascending (least usage first)
  members.sort((a, b) => a.usagePercent - b.usagePercent);

  return { segments, members };
}
