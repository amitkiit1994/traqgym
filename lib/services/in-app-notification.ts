import { prisma } from "@/lib/prisma";

type NotifyUserParams = {
  userId: number;
  type: string;
  title: string;
  message?: string;
  link?: string;
};

type NotifyWorkerParams = {
  workerId: number;
  type: string;
  title: string;
  message?: string;
  link?: string;
};

type NotifyByRoleParams = {
  role: string;
  type: string;
  title: string;
  message?: string;
  link?: string;
};

export async function notifyUser(params: NotifyUserParams) {
  const notif = await prisma.inAppNotification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
    },
  });
  return { success: true as const, id: notif.id };
}

export async function notifyWorker(params: NotifyWorkerParams) {
  const notif = await prisma.inAppNotification.create({
    data: {
      workerId: params.workerId,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
    },
  });
  return { success: true as const, id: notif.id };
}

export async function notifyWorkersByRole(params: NotifyByRoleParams) {
  const workers = await prisma.worker.findMany({
    where: { role: params.role, isActive: true },
    select: { id: true },
  });

  if (workers.length === 0) return { success: true as const, count: 0 };

  await prisma.inAppNotification.createMany({
    data: workers.map((w) => ({
      workerId: w.id,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
    })),
  });

  return { success: true as const, count: workers.length };
}

export async function getNotifications(params: {
  userId?: number;
  workerId?: number;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = {};
  if (params.userId) where.userId = params.userId;
  if (params.workerId) where.workerId = params.workerId;

  const [notifications, unreadCount] = await Promise.all([
    prisma.inAppNotification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.limit ?? 20,
      skip: params.offset ?? 0,
    }),
    prisma.inAppNotification.count({
      where: { ...where, readAt: null },
    }),
  ]);

  return { notifications, unreadCount };
}

export async function getUnreadCount(params: {
  userId?: number;
  workerId?: number;
}) {
  const where: Record<string, unknown> = { readAt: null };
  if (params.userId) where.userId = params.userId;
  if (params.workerId) where.workerId = params.workerId;

  return prisma.inAppNotification.count({ where });
}

export async function markRead(
  id: number,
  owner: { userId?: number; workerId?: number }
) {
  await prisma.inAppNotification.updateMany({
    where: { id, ...owner, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(owner: {
  userId?: number;
  workerId?: number;
}) {
  await prisma.inAppNotification.updateMany({
    where: { ...owner, readAt: null },
    data: { readAt: new Date() },
  });
}
