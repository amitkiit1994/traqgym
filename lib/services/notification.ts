import { prisma } from "@/lib/prisma";

export async function dispatch(params: {
  userId: number;
  templateName: string;
  channel: string;
  recipient?: string;
  deliveryDate: Date;
}) {
  // Check if already dispatched today for this user+template
  const existing = await prisma.notificationLog.findUnique({
    where: {
      userId_templateName_deliveryDate: {
        userId: params.userId,
        templateName: params.templateName,
        deliveryDate: params.deliveryDate,
      },
    },
  });

  if (existing) {
    return { success: true, id: existing.id, skipped: true };
  }

  const log = await prisma.notificationLog.create({
    data: {
      userId: params.userId,
      templateName: params.templateName,
      channel: params.channel,
      recipient: params.recipient ?? null,
      status: "pending",
      deliveryDate: params.deliveryDate,
    },
  });

  return { success: true, id: log.id, skipped: false };
}

export async function markSent(id: number) {
  return prisma.notificationLog.update({
    where: { id },
    data: { status: "sent", sentAt: new Date() },
  });
}

export async function markFailed(id: number, errorMessage: string) {
  return prisma.notificationLog.update({
    where: { id },
    data: { status: "failed", errorMessage },
  });
}

export async function getLog(params?: {
  limit?: number;
  offset?: number;
}) {
  return prisma.notificationLog.findMany({
    include: {
      user: { select: { id: true, firstname: true, lastname: true } },
    },
    orderBy: { createdAt: "desc" },
    take: params?.limit ?? 50,
    skip: params?.offset ?? 0,
  });
}
