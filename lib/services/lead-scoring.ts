import { prisma } from "@/lib/prisma";

export type ColdLead = {
  enquiryId: number;
  name: string;
  phone: string;
  source: string;
  stage: string;
  daysSinceLastActivity: number;
  followupCount: number;
  lastNote: string | null;
};

/**
 * Finds enquiries that have gone cold — no follow-up in `gapHours` hours,
 * still in an active stage (not converted/lost/closed).
 */
export async function getColdLeads(params: {
  gapHours: number;
  maxResults: number;
}): Promise<ColdLead[]> {
  const cutoff = new Date(Date.now() - params.gapHours * 3600000);

  const enquiries = await prisma.enquiry.findMany({
    where: {
      status: { in: ["new", "follow_up", "interested"] },
      stage: { notIn: ["converted", "lost"] },
      updatedAt: { lt: cutoff },
    },
    include: {
      followups: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { notes: true, createdAt: true },
      },
    },
    orderBy: { updatedAt: "asc" },
    take: params.maxResults,
  });

  const today = new Date();

  return enquiries.map((e) => {
    const lastActivity = e.followups[0]?.createdAt ?? e.updatedAt;
    const daysSince = Math.floor(
      (today.getTime() - lastActivity.getTime()) / 86400000
    );

    return {
      enquiryId: e.id,
      name: e.name,
      phone: e.phone,
      source: e.source,
      stage: e.stage,
      daysSinceLastActivity: daysSince,
      followupCount: e.followups.length,
      lastNote: e.followups[0]?.notes ?? null,
    };
  });
}
