"use client";

import { NotificationBell } from "@/components/notification-bell";
import {
  getWorkerInAppNotifications,
  getWorkerUnreadCount,
  markWorkerNotificationRead,
  markAllWorkerNotificationsRead,
} from "@/lib/actions/in-app-notifications";

export function AdminNotificationBell() {
  return (
    <NotificationBell
      fetchUnreadCount={getWorkerUnreadCount}
      fetchNotifications={getWorkerInAppNotifications}
      markRead={markWorkerNotificationRead}
      markAllRead={markAllWorkerNotificationsRead}
      allHref="/admin/in-app-notifications"
    />
  );
}
