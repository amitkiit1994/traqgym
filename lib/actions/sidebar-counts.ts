"use server";

import { prisma } from "@/lib/prisma";

export async function getSidebarCounts() {
  const [pendingFollowups, newEnquiries, balanceDueCount, pendingLeaves] =
    await Promise.all([
      prisma.paymentFollowup.count({ where: { status: "pending" } }),
      prisma.enquiry.count({ where: { status: "new" } }),
      prisma.memberTicket.count({
        where: { balanceDue: { gt: 0 }, status: "active" },
      }),
      prisma.leaveRequest.count({ where: { status: "pending" } }),
    ]);

  return { pendingFollowups, newEnquiries, balanceDueCount, pendingLeaves };
}
