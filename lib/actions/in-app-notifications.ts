"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} from "@/lib/services/in-app-notification";

export async function getWorkerInAppNotifications(
  limit?: number,
  offset?: number
) {
  try {
    const session = await requireWorker();
    const workerId = parseInt(session.user.id, 10);
    return getNotifications({ workerId, limit, offset });
  } catch {
    return { notifications: [], unreadCount: 0 };
  }
}

export async function getWorkerUnreadCount(): Promise<number> {
  try {
    const session = await requireWorker();
    const workerId = parseInt(session.user.id, 10);
    return getUnreadCount({ workerId });
  } catch {
    return 0;
  }
}

export async function markWorkerNotificationRead(id: number) {
  try {
    const session = await requireWorker();
    const workerId = parseInt(session.user.id, 10);
    await markRead(id, { workerId });
    return { success: true };
  } catch {
    return { success: false };
  }
}

export async function markAllWorkerNotificationsRead() {
  try {
    const session = await requireWorker();
    const workerId = parseInt(session.user.id, 10);
    await markAllRead({ workerId });
    return { success: true };
  } catch {
    return { success: false };
  }
}
