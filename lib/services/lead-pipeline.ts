import { prisma } from "@/lib/prisma";

const VALID_STAGES = [
  "new",
  "contacted",
  "tour_scheduled",
  "tour_done",
  "trial",
  "negotiation",
  "converted",
  "lost",
] as const;

type Stage = (typeof VALID_STAGES)[number];

// Valid forward transitions (plus "lost" is always allowed)
const STAGE_TRANSITIONS: Record<string, string[]> = {
  new: ["contacted", "lost"],
  contacted: ["tour_scheduled", "trial", "lost"],
  tour_scheduled: ["tour_done", "lost"],
  tour_done: ["trial", "negotiation", "lost"],
  trial: ["negotiation", "converted", "lost"],
  negotiation: ["converted", "lost"],
  converted: [],
  lost: ["new"], // reopen
};

export async function getPipeline(locationId?: number) {
  try {
    const where: Record<string, unknown> = {};
    if (locationId) where.locationId = locationId;

    const counts = await prisma.enquiry.groupBy({
      by: ["stage"],
      where,
      _count: { id: true },
    });

    const pipeline: Record<string, number> = {};
    for (const stage of VALID_STAGES) {
      pipeline[stage] = 0;
    }
    for (const row of counts) {
      pipeline[row.stage] = row._count.id;
    }

    const total = Object.values(pipeline).reduce((sum, c) => sum + c, 0);

    return { pipeline, total };
  } catch (err) {
    console.error("[LeadPipeline] getPipeline error:", err);
    return { pipeline: {}, total: 0 };
  }
}

export async function moveStage(enquiryId: number, newStage: string) {
  try {
    if (!VALID_STAGES.includes(newStage as Stage)) {
      return { success: false as const, error: `Invalid stage: ${newStage}` };
    }

    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      select: { id: true, stage: true, name: true },
    });

    if (!enquiry) {
      return { success: false as const, error: "Enquiry not found" };
    }

    const currentStage = enquiry.stage;
    const allowed = STAGE_TRANSITIONS[currentStage] ?? [];

    if (!allowed.includes(newStage)) {
      return {
        success: false as const,
        error: `Cannot move from "${currentStage}" to "${newStage}". Allowed transitions: ${allowed.join(", ") || "none"}`,
      };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.enquiry.update({
        where: { id: enquiryId },
        data: {
          stage: newStage,
          status: newStage === "converted" ? "converted" : newStage === "lost" ? "lost" : enquiry.stage === "new" ? "contacted" : undefined,
        },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          action: "lead_stage_change",
          status: "success",
          details: `Enquiry #${enquiryId} (${enquiry.name}): ${currentStage} → ${newStage}`,
        },
      });

      return result;
    });

    return { success: true as const, enquiry: { id: updated.id, stage: updated.stage, name: updated.name } };
  } catch (err) {
    console.error("[LeadPipeline] moveStage error:", err);
    return { success: false as const, error: "Failed to move lead stage" };
  }
}
