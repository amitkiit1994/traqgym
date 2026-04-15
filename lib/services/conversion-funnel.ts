import { prisma } from "@/lib/prisma";

const STAGES = [
  "new",
  "contacted",
  "tour_scheduled",
  "tour_done",
  "trial",
  "negotiation",
  "converted",
  "lost",
] as const;

export type FunnelStage = {
  stage: string;
  count: number;
  conversionRate: number; // rate from previous stage to this one (%)
};

export type ConversionFunnelResult = {
  stages: FunnelStage[];
  totalConversionRate: number; // new → converted (%)
};

export async function getConversionFunnel(params?: {
  startDate?: Date;
  endDate?: Date;
  locationId?: number;
}): Promise<ConversionFunnelResult> {
  try {
    const where: Record<string, unknown> = {};
    if (params?.startDate || params?.endDate) {
      const created: Record<string, Date> = {};
      if (params.startDate) created.gte = params.startDate;
      if (params.endDate) created.lte = params.endDate;
      where.createdAt = created;
    }
    if (params?.locationId) where.locationId = params.locationId;

    const groups = await prisma.enquiry.groupBy({
      by: ["stage"],
      _count: true,
      where,
    });

    const countMap = new Map(groups.map((g) => [g.stage, g._count]));

    // Build funnel — exclude "lost" from conversion chain
    const funnelOrder = STAGES.filter((s) => s !== "lost");
    const stages: FunnelStage[] = [];

    for (let i = 0; i < funnelOrder.length; i++) {
      const stage = funnelOrder[i];
      const count = countMap.get(stage) ?? 0;
      let conversionRate = 0;
      if (i > 0) {
        const prevCount = stages[i - 1].count;
        conversionRate = prevCount > 0 ? Math.round((count / prevCount) * 10000) / 100 : 0;
      }
      stages.push({ stage, count, conversionRate });
    }

    // Add "lost" at the end (no conversion rate for it)
    const lostCount = countMap.get("lost") ?? 0;
    stages.push({ stage: "lost", count: lostCount, conversionRate: 0 });

    const newCount = countMap.get("new") ?? 0;
    const convertedCount = countMap.get("converted") ?? 0;
    const totalConversionRate =
      newCount > 0 ? Math.round((convertedCount / newCount) * 10000) / 100 : 0;

    return { stages, totalConversionRate };
  } catch (err) {
    console.error("[ConversionFunnel] getConversionFunnel error:", err);
    return { stages: [], totalConversionRate: 0 };
  }
}
