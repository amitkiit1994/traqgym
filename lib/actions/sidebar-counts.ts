"use server";

import { prisma } from "@/lib/prisma";
import { unstable_cache } from "next/cache";

const getCachedSidebarCounts = unstable_cache(
  async () => {
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
  },
  ["sidebar-counts"],
  { tags: ["sidebar-counts"], revalidate: 30 }
);

export async function getSidebarCounts() {
  return getCachedSidebarCounts();
}
