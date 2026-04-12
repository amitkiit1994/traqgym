import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

export type ActionItem = {
  type: "enquiry_followup" | "payment_followup" | "expiring_member" | "inactive_member" | "birthday" | "pending_leave";
  label: string;
  count: number;
  href: string;
  priority: "high" | "medium" | "low";
};

/**
 * Aggregates today's priorities for the staff action list.
 * No AI — just smart queries.
 */
export async function getDailyActions(): Promise<ActionItem[]> {
  const today = todayIST();

  const threeDaysOut = new Date(today);
  threeDaysOut.setDate(threeDaysOut.getDate() + 3);

  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [
    overdueEnquiries,
    overduePayments,
    expiringMembers,
    inactiveMembers,
    birthdaysToday,
    pendingLeaves,
  ] = await Promise.all([
    // Enquiries needing follow-up (updated > 2 days ago, not converted/lost)
    prisma.enquiry.count({
      where: {
        status: { in: ["new", "follow_up", "interested"] },
        stage: { notIn: ["converted", "lost"] },
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

    // Memberships expiring in next 3 days
    prisma.memberTicket.count({
      where: {
        expireDate: { gte: today, lte: threeDaysOut },
      },
    }),

    // Active members inactive for 7+ days
    prisma.user.count({
      where: {
        memberTickets: {
          some: { expireDate: { gte: today } },
        },
        attendanceLogs: {
          none: { checkIn: { gte: sevenDaysAgo } },
        },
      },
    }),

    // Birthdays today
    prisma.user.findMany({
      where: { birthdate: { not: null } },
      select: { birthdate: true },
    }).then((users) => {
      const todayMonth = today.getMonth();
      const todayDay = today.getDate();
      return users.filter((u) => {
        const bd = new Date(u.birthdate!);
        return bd.getMonth() === todayMonth && bd.getDate() === todayDay;
      }).length;
    }),

    // Pending leave requests
    prisma.leaveRequest.count({
      where: { status: "pending" },
    }),
  ]);

  const items: ActionItem[] = [];

  if (overdueEnquiries > 0) {
    items.push({
      type: "enquiry_followup",
      label: "Enquiry follow-ups overdue",
      count: overdueEnquiries,
      href: "/admin/enquiries",
      priority: "high",
    });
  }

  if (overduePayments > 0) {
    items.push({
      type: "payment_followup",
      label: "Payment follow-ups overdue",
      count: overduePayments,
      href: "/admin/followups",
      priority: "high",
    });
  }

  if (expiringMembers > 0) {
    items.push({
      type: "expiring_member",
      label: "Memberships expiring in 3 days",
      count: expiringMembers,
      href: "/admin/renewals",
      priority: "medium",
    });
  }

  if (inactiveMembers > 0) {
    items.push({
      type: "inactive_member",
      label: "Members inactive 7+ days",
      count: inactiveMembers,
      href: "/admin/members",
      priority: "medium",
    });
  }

  if (birthdaysToday > 0) {
    items.push({
      type: "birthday",
      label: "Member birthdays today",
      count: birthdaysToday,
      href: "/admin/members",
      priority: "low",
    });
  }

  if (pendingLeaves > 0) {
    items.push({
      type: "pending_leave",
      label: "Pending leave requests",
      count: pendingLeaves,
      href: "/admin/leaves",
      priority: "low",
    });
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return items;
}
