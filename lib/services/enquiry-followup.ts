import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";

export async function addFollowup(params: {
  enquiryId: number;
  workerId: number;
  action: string;
  outcome: string;
  notes?: string;
  nextFollowupAt?: Date;
}) {
  const enquiry = await prisma.enquiry.findUnique({ where: { id: params.enquiryId } });
  if (!enquiry) return { success: false, error: "Enquiry not found" };

  const worker = await prisma.worker.findUnique({ where: { id: params.workerId } });
  if (!worker) return { success: false, error: "Worker not found" };

  const followup = await prisma.enquiryFollowup.create({
    data: {
      enquiryId: params.enquiryId,
      workerId: params.workerId,
      action: params.action,
      outcome: params.outcome,
      notes: params.notes,
      nextFollowupAt: params.nextFollowupAt,
    },
  });

  // If converted, update enquiry stage
  if (params.outcome === "converted") {
    await prisma.enquiry.update({
      where: { id: params.enquiryId },
      data: { status: "converted", stage: "converted" },
    });
  }

  return {
    success: true,
    followupId: followup.id,
    createdAt: followup.createdAt.toISOString(),
  };
}

export async function getFollowupHistory(enquiryId: number) {
  const enquiry = await prisma.enquiry.findUnique({ where: { id: enquiryId } });
  if (!enquiry) return { success: false, error: "Enquiry not found" };

  const followups = await prisma.enquiryFollowup.findMany({
    where: { enquiryId },
    include: {
      worker: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    success: true,
    enquiry: {
      id: enquiry.id,
      name: enquiry.name,
      phone: enquiry.phone,
      status: enquiry.status,
      stage: enquiry.stage,
    },
    followups: followups.map((f) => ({
      id: f.id,
      action: f.action,
      outcome: f.outcome,
      notes: f.notes,
      workerName: `${f.worker.firstname} ${f.worker.lastname}`,
      nextFollowupAt: f.nextFollowupAt?.toISOString() ?? null,
      createdAt: f.createdAt.toISOString(),
    })),
  };
}

export async function getOverdueEnquiryFollowups(workerId?: number) {
  const now = new Date();

  // Get the latest followup per enquiry that has nextFollowupAt < now
  const followups = await prisma.enquiryFollowup.findMany({
    where: {
      nextFollowupAt: { lt: now },
      ...(workerId ? { workerId } : {}),
      enquiry: {
        status: { notIn: ["converted", "lost"] },
      },
    },
    include: {
      enquiry: { select: { id: true, name: true, phone: true, status: true, stage: true } },
      worker: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { nextFollowupAt: "asc" },
  });

  // Keep only the latest followup per enquiry
  const latestByEnquiry = new Map<number, typeof followups[0]>();
  for (const f of followups) {
    const existing = latestByEnquiry.get(f.enquiryId);
    if (!existing || f.createdAt > existing.createdAt) {
      latestByEnquiry.set(f.enquiryId, f);
    }
  }

  // Filter: only keep if this latest followup is the one that's overdue
  const overdue = Array.from(latestByEnquiry.values()).filter(
    (f) => f.nextFollowupAt && f.nextFollowupAt < now
  );

  return {
    success: true,
    overdue: overdue.map((f) => ({
      followupId: f.id,
      enquiryId: f.enquiry.id,
      enquiryName: f.enquiry.name,
      phone: f.enquiry.phone,
      stage: f.enquiry.stage,
      lastAction: f.action,
      lastOutcome: f.outcome,
      scheduledAt: f.nextFollowupAt!.toISOString(),
      workerName: `${f.worker.firstname} ${f.worker.lastname}`,
    })),
  };
}

export async function getTodayFollowups(workerId?: number) {
  const today = todayIST();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const followups = await prisma.enquiryFollowup.findMany({
    where: {
      nextFollowupAt: { gte: today, lt: tomorrow },
      ...(workerId ? { workerId } : {}),
      enquiry: {
        status: { notIn: ["converted", "lost"] },
      },
    },
    include: {
      enquiry: { select: { id: true, name: true, phone: true, status: true, stage: true } },
      worker: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { nextFollowupAt: "asc" },
  });

  // Keep only latest per enquiry
  const latestByEnquiry = new Map<number, typeof followups[0]>();
  for (const f of followups) {
    const existing = latestByEnquiry.get(f.enquiryId);
    if (!existing || f.createdAt > existing.createdAt) {
      latestByEnquiry.set(f.enquiryId, f);
    }
  }

  const todayList = Array.from(latestByEnquiry.values());

  return {
    success: true,
    followups: todayList.map((f) => ({
      followupId: f.id,
      enquiryId: f.enquiry.id,
      enquiryName: f.enquiry.name,
      phone: f.enquiry.phone,
      stage: f.enquiry.stage,
      lastAction: f.action,
      lastOutcome: f.outcome,
      scheduledAt: f.nextFollowupAt!.toISOString(),
      workerName: `${f.worker.firstname} ${f.worker.lastname}`,
    })),
  };
}

export async function assignEnquiry(enquiryId: number, workerId: number) {
  const enquiry = await prisma.enquiry.findUnique({ where: { id: enquiryId } });
  if (!enquiry) return { success: false, error: "Enquiry not found" };

  const worker = await prisma.worker.findUnique({ where: { id: workerId } });
  if (!worker) return { success: false, error: "Worker not found" };
  if (!worker.isActive) return { success: false, error: "Worker is not active" };

  await prisma.enquiry.update({
    where: { id: enquiryId },
    data: { assignedTo: workerId },
  });

  // In-app notification for assigned worker (fire-and-forget)
  try {
    const { notifyWorker } = await import("@/lib/services/in-app-notification");
    await notifyWorker({
      workerId,
      type: "enquiry_assigned",
      title: `Enquiry assigned: ${enquiry.name}`,
      message: enquiry.phone,
      link: "/admin/enquiries",
    });
  } catch {}

  return {
    success: true,
    enquiryId,
    assignedTo: `${worker.firstname} ${worker.lastname}`,
  };
}
