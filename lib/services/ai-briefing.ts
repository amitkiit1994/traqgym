import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

/**
 * Gathers raw data for the daily AI briefing.
 * The AI agent will interpret and format this into a human-friendly summary.
 */
export async function gatherBriefingContext(): Promise<string> {
  const today = todayIST();

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [
    yesterdayPayments,
    yesterdayAttendance,
    newMembersYesterday,
    expiringThisWeek,
    overdueEnquiries,
    overduePayments,
    birthdaysToday,
    activeMembers,
    weekAgoAttendance,
  ] = await Promise.all([
    // Yesterday's revenue
    prisma.payment.aggregate({
      _sum: { amount: true },
      _count: true,
      where: {
        createdAt: { gte: yesterday, lt: today },
      },
    }),

    // Yesterday's attendance
    prisma.attendanceLog.count({
      where: {
        checkIn: { gte: yesterday, lt: today },
        userId: { not: null },
      },
    }),

    // New members yesterday
    prisma.user.count({
      where: {
        createdAt: { gte: yesterday, lt: today },
      },
    }),

    // Memberships expiring in next 7 days
    prisma.memberTicket.findMany({
      where: {
        expireDate: { gte: today, lte: weekAgo.getTime() > today.getTime() ? weekAgo : new Date(today.getTime() + 7 * 86400000) },
      },
      include: {
        user: { select: { firstname: true, lastname: true, phone: true } },
        plan: { select: { name: true } },
      },
      orderBy: { expireDate: "asc" },
      take: 20,
    }),

    // Overdue enquiry follow-ups (last follow-up > 2 days ago, not converted/closed)
    prisma.enquiry.count({
      where: {
        status: { in: ["new", "follow_up", "interested"] },
        updatedAt: { lt: new Date(today.getTime() - 2 * 86400000) },
      },
    }),

    // Overdue payment follow-ups
    prisma.paymentFollowup.count({
      where: {
        status: { in: ["pending", "in_progress"] },
        nextFollowupAt: { lt: today },
      },
    }),

    // Birthdays today
    prisma.user.findMany({
      where: { birthdate: { not: null } },
      select: { firstname: true, lastname: true, birthdate: true },
    }),

    // Total active members
    prisma.memberTicket.count({
      where: { expireDate: { gte: today } },
    }),

    // Attendance same day last week (for comparison)
    prisma.attendanceLog.count({
      where: {
        checkIn: {
          gte: new Date(yesterday.getTime() - 7 * 86400000),
          lt: new Date(today.getTime() - 7 * 86400000),
        },
        userId: { not: null },
      },
    }),
  ]);

  // Filter birthdays for today
  const todayMonth = today.getMonth();
  const todayDay = today.getDate();
  const todayBirthdays = birthdaysToday.filter((u) => {
    const bd = new Date(u.birthdate!);
    return bd.getMonth() === todayMonth && bd.getDate() === todayDay;
  });

  // Format expiring memberships
  const expiringList = expiringThisWeek
    .map((t) => `${t.user.firstname} ${t.user.lastname} — ${t.plan.name}, expires ${t.expireDate.toISOString().split("T")[0]}`)
    .join("\n");

  const attendanceChange = weekAgoAttendance > 0
    ? Math.round(((yesterdayAttendance - weekAgoAttendance) / weekAgoAttendance) * 100)
    : 0;

  return `## Daily Briefing Data (${today.toISOString().split("T")[0]})

### Yesterday's Numbers
- Revenue: ₹${(yesterdayPayments._sum.amount ?? 0).toLocaleString("en-IN")} (${yesterdayPayments._count} payments)
- Attendance: ${yesterdayAttendance} check-ins (${attendanceChange >= 0 ? "+" : ""}${attendanceChange}% vs last week)
- New members: ${newMembersYesterday}

### Active Members: ${activeMembers}

### Memberships Expiring This Week (${expiringThisWeek.length})
${expiringList || "None"}

### Overdue Follow-ups
- Enquiries needing follow-up: ${overdueEnquiries}
- Payment follow-ups overdue: ${overduePayments}

### Birthdays Today (${todayBirthdays.length})
${todayBirthdays.map((u) => `${u.firstname} ${u.lastname}`).join(", ") || "None"}

Based on this data, generate a concise morning briefing for the gym owner. Highlight anything that needs immediate attention. Keep it under 300 words — this will be sent via WhatsApp.`;
}
