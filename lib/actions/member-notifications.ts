"use server";

import { prisma } from "@/lib/prisma";
import { requireMember } from "@/lib/auth-guard";
import {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} from "@/lib/services/in-app-notification";

export async function getMemberNotifications(params?: {
  channel?: string;
  limit?: number;
  offset?: number;
}) {
  let session;
  try { session = await requireMember(); } catch { return { notifications: [], unreadCount: 0 }; }

  const userId = Number(session.user.id);

  const where: Record<string, unknown> = {
    userId,
    status: "sent",
  };
  if (params?.channel) where.channel = params.channel;

  const [notifications, unreadCount] = await Promise.all([
    prisma.notificationLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params?.limit ?? 20,
      skip: params?.offset ?? 0,
      select: {
        id: true,
        templateName: true,
        channel: true,
        deliveryDate: true,
        sentAt: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notificationLog.count({
      where: { userId, status: "sent", readAt: null },
    }),
  ]);

  return {
    notifications: notifications.map((n) => ({
      id: n.id,
      templateName: n.templateName,
      channel: n.channel,
      deliveryDate: n.deliveryDate.toISOString(),
      sentAt: n.sentAt?.toISOString() ?? null,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount,
  };
}

export async function getUnreadNotificationCount() {
  let session;
  try { session = await requireMember(); } catch { return 0; }

  const userId = Number(session.user.id);
  return prisma.notificationLog.count({
    where: { userId, status: "sent", readAt: null },
  });
}

export async function markNotificationRead(id: number) {
  let session;
  try { session = await requireMember(); } catch { return { success: false }; }

  const userId = Number(session.user.id);

  await prisma.notificationLog.updateMany({
    where: { id, userId },
    data: { readAt: new Date() },
  });

  return { success: true };
}

export async function markAllNotificationsRead() {
  let session;
  try { session = await requireMember(); } catch { return { success: false }; }

  const userId = Number(session.user.id);

  await prisma.notificationLog.updateMany({
    where: { userId, status: "sent", readAt: null },
    data: { readAt: new Date() },
  });

  return { success: true };
}

// ---- In-App Notifications (separate from outbound NotificationLog) ----

export async function getMemberInAppNotifications(
  limit?: number,
  offset?: number
) {
  try {
    const session = await requireMember();
    const userId = Number(session.user.id);
    return getNotifications({ userId, limit, offset });
  } catch {
    return { notifications: [], unreadCount: 0 };
  }
}

export async function getMemberInAppUnreadCount(): Promise<number> {
  try {
    const session = await requireMember();
    const userId = Number(session.user.id);
    return getUnreadCount({ userId });
  } catch {
    return 0;
  }
}

export async function markMemberInAppRead(id: number) {
  try {
    const session = await requireMember();
    const userId = Number(session.user.id);
    await markRead(id, { userId });
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function markAllMemberInAppRead() {
  try {
    const session = await requireMember();
    const userId = Number(session.user.id);
    await markAllRead({ userId });
    return { success: true };
  } catch {
    return { success: false };
  }
}
