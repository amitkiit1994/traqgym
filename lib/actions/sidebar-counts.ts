"use server";

import { prisma } from "@/lib/prisma";
import { unstable_cache } from "next/cache";

const getCachedSidebarCounts = unstable_cache(
  async () => {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const [
      pendingFollowups,
      newEnquiries,
      balanceDueCount,
      pendingLeaves,
      pendingApprovalsCount,
    ] = await Promise.all([
      prisma.paymentFollowup.count({ where: { status: { in: ["pending", "contacted", "promised"] }, amountDue: { gt: 0 }, dueDate: { gte: ninetyDaysAgo, lt: new Date() } } }),
      (() => {
        const onetwentyDaysAgo = new Date();
        onetwentyDaysAgo.setDate(onetwentyDaysAgo.getDate() - 120);
        return prisma.enquiry.count({ where: { status: "new", createdAt: { gte: onetwentyDaysAgo } } });
      })(),
      prisma.memberTicket.count({
        where: { balanceDue: { gt: 0 }, status: "active" },
      }),
      prisma.leaveRequest.count({ where: { status: "pending" } }),
      prisma.approval.count({ where: { status: "pending" } }),
    ]);

    return {
      pendingFollowups,
      newEnquiries,
      balanceDueCount,
      pendingLeaves,
      pendingApprovalsCount,
    };
  },
  ["sidebar-counts"],
  { tags: ["sidebar-counts"], revalidate: 30 }
);

export async function getSidebarCounts() {
  return getCachedSidebarCounts();
}
