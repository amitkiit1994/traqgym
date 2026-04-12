import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

export type Milestone = {
  userId: number;
  name: string;
  phone: string | null;
  type: "streak" | "anniversary" | "first_class";
  label: string;
  value: number;
};

/**
 * Detects member milestones for celebration messages.
 * No AI needed — template-based WhatsApp messages.
 */
export async function getTodayMilestones(): Promise<Milestone[]> {
  const today = todayIST();

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const milestones: Milestone[] = [];

  // 1. Attendance streaks (30, 50, 100, 200, 365 days)
  const streakThresholds = [30, 50, 100, 200, 365];
  const activeMembers = await prisma.user.findMany({
    where: {
      memberTickets: { some: { expireDate: { gte: today } } },
    },
    select: {
      id: true,
      firstname: true,
      lastname: true,
      phone: true,
      attendanceLogs: {
        where: { userId: { not: null } },
        orderBy: { checkIn: "desc" },
        select: { checkIn: true },
      },
    },
  });

  for (const member of activeMembers) {
    if (member.attendanceLogs.length === 0) continue;

    // Count consecutive days with attendance (looking backward from yesterday)
    const attendanceDates = new Set(
      member.attendanceLogs.map((a) => a.checkIn.toISOString().split("T")[0])
    );

    let streak = 0;
    const checkDate = new Date(yesterday);
    while (attendanceDates.has(checkDate.toISOString().split("T")[0])) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }

    for (const threshold of streakThresholds) {
      if (streak === threshold) {
        milestones.push({
          userId: member.id,
          name: `${member.firstname} ${member.lastname}`,
          phone: member.phone,
          type: "streak",
          label: `${threshold}-day attendance streak!`,
          value: threshold,
        });
      }
    }
  }

  // 2. Membership anniversaries (6 months, 1 year, 2 years)
  const anniversaryMonths = [6, 12, 24];
  for (const months of anniversaryMonths) {
    const targetDate = new Date(today);
    targetDate.setMonth(targetDate.getMonth() - months);

    const anniversaryMembers = await prisma.user.findMany({
      where: {
        createdAt: {
          gte: targetDate,
          lt: new Date(targetDate.getTime() + 86400000),
        },
        memberTickets: { some: { expireDate: { gte: today } } },
      },
      select: { id: true, firstname: true, lastname: true, phone: true },
    });

    for (const member of anniversaryMembers) {
      const label = months >= 12
        ? `${months / 12} year${months > 12 ? "s" : ""} anniversary!`
        : `${months} month anniversary!`;

      milestones.push({
        userId: member.id,
        name: `${member.firstname} ${member.lastname}`,
        phone: member.phone,
        type: "anniversary",
        label,
        value: months,
      });
    }
  }

  return milestones;
}
