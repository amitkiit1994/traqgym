import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";

export async function archiveStaleFollowups(maxAgeDays: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  const result = await prisma.paymentFollowup.updateMany({
    where: {
      status: { in: ["pending", "contacted", "promised"] },
      dueDate: { lt: cutoff },
    },
    data: {
      status: "written_off",
      notes: prisma.paymentFollowup.fields
        ? undefined
        : undefined,
    },
  });

  // Append note via raw query since updateMany doesn't support concatenation
  if (result.count > 0) {
    await prisma.$executeRaw`
      UPDATE "PaymentFollowup"
      SET notes = COALESCE(notes, '') || ${`\n[Auto-archived: overdue >${maxAgeDays} days]`}
      WHERE status = 'written_off'
        AND "dueDate" < ${cutoff}
        AND notes NOT LIKE '%Auto-archived%'
    `;
  }

  return { archived: result.count };
}

export async function closeStaleEnquiries(maxAgeDays: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  const result = await prisma.enquiry.updateMany({
    where: {
      status: { notIn: ["converted", "lost"] },
      updatedAt: { lt: cutoff },
    },
    data: {
      status: "lost",
    },
  });

  if (result.count > 0) {
    await prisma.$executeRaw`
      UPDATE "Enquiry"
      SET notes = COALESCE(notes, '') || ${`\n[Auto-closed: no activity >${maxAgeDays} days]`}
      WHERE status = 'lost'
        AND "updatedAt" < ${cutoff}
        AND (notes IS NULL OR notes NOT LIKE '%Auto-closed%')
    `;
  }

  return { closed: result.count };
}

export async function runFullCleanup() {
  const followupDays = parseInt(
    await getSetting("followup_auto_archive_days", "180"),
    10
  );
  const enquiryDays = parseInt(
    await getSetting("enquiry_auto_close_days", "120"),
    10
  );

  const [followupResult, enquiryResult] = await Promise.all([
    archiveStaleFollowups(followupDays),
    closeStaleEnquiries(enquiryDays),
  ]);

  // Notify admins
  try {
    const { notifyWorkersByRole } = await import(
      "@/lib/services/in-app-notification"
    );
    const parts: string[] = [];
    if (followupResult.archived > 0)
      parts.push(`${followupResult.archived} followups auto-archived`);
    if (enquiryResult.closed > 0)
      parts.push(`${enquiryResult.closed} enquiries auto-closed`);

    if (parts.length > 0) {
      await notifyWorkersByRole({
        role: "admin",
        type: "data_cleanup",
        title: "Data cleanup completed",
        message: parts.join(", "),
        link: "/admin/settings",
      });
    }
  } catch {}

  return {
    followupsArchived: followupResult.archived,
    enquiriesClosed: enquiryResult.closed,
  };
}
