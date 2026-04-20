import { prisma } from "@/lib/prisma";
import { getOverdueKeys } from "@/lib/services/locker-key";
import { notifyWorkersByRole } from "@/lib/services/in-app-notification";

/**
 * Daily agent: flags locker keys not returned within
 * `expectedReturnAt + thresholdDays`. Creates an in-app insight
 * for admins per overdue key (idempotent within 24 h to avoid spam).
 */
export async function runOverdueKeys(thresholdDays = 7) {
  const overdue = await getOverdueKeys(thresholdDays);

  if (overdue.length === 0) {
    return { insightsCreated: 0, overdueCount: 0 };
  }

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let insightsCreated = 0;

  for (const item of overdue) {
    // De-dupe: skip if any worker already received an insight for this issuance in the last 24h
    const existing = await prisma.inAppNotification.findFirst({
      where: {
        type: "locker_key_overdue",
        link: `/admin/lockers?issuance=${item.id}`,
        createdAt: { gte: oneDayAgo },
      },
    });
    if (existing) continue;

    const memberName = `${item.user.firstname} ${item.user.lastname}`.trim();
    const expectedDate = item.expectedReturnAt
      ? new Date(item.expectedReturnAt).toLocaleDateString("en-IN")
      : "(no due date)";

    const result = await notifyWorkersByRole({
      role: "admin",
      type: "locker_key_overdue",
      title: `Locker key overdue: #${item.locker.number}`,
      message: `${memberName} has not returned key (deposit ₹${Number(item.depositAmount).toLocaleString("en-IN")}) — expected ${expectedDate}`,
      link: `/admin/lockers?issuance=${item.id}`,
    });

    if (result.success && result.count > 0) {
      insightsCreated += result.count;
    }
  }

  return { insightsCreated, overdueCount: overdue.length };
}
