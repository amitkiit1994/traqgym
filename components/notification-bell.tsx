"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { NOTIFICATION_LABELS } from "@/lib/notification-types";
import { stripMarkdown, timeAgo } from "@/lib/utils/format";

type Notification = {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  readAt: Date | string | null;
  createdAt: Date | string;
};

type Props = {
  fetchUnreadCount: () => Promise<number>;
  fetchNotifications: (
    limit?: number,
    offset?: number
  ) => Promise<{ notifications: Notification[]; unreadCount: number }>;
  markRead: (id: number) => Promise<{ success: boolean }>;
  markAllRead: () => Promise<{ success: boolean }>;
  allHref: string;
};

export function NotificationBell({
  fetchUnreadCount,
  fetchNotifications,
  markRead,
  markAllRead,
  allHref,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isPending, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);

  // Refresh unread count on navigation
  useEffect(() => {
    fetchUnreadCount().then(setUnreadCount);
  }, [pathname, fetchUnreadCount]);

  // Close panel on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const toggle = () => {
    if (!open) {
      startTransition(async () => {
        const data = await fetchNotifications(10);
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      });
    }
    setOpen((v) => !v);
  };

  const handleClick = (notif: Notification) => {
    if (!notif.readAt) {
      startTransition(async () => {
        await markRead(notif.id);
        setUnreadCount((c) => Math.max(0, c - 1));
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notif.id ? { ...n, readAt: new Date().toISOString() } : n
          )
        );
      });
    }
    if (notif.link) {
      setOpen(false);
      router.push(notif.link);
    }
  };

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllRead();
      setUnreadCount(0);
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() }))
      );
    });
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={toggle}
        className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 max-h-[420px] rounded-xl border border-border/50 bg-popover shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                disabled={isPending}
                className="text-xs text-primary hover:underline disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="overflow-y-auto max-h-[320px]">
            {notifications.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No notifications
              </p>
            ) : (
              notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={cn(
                    "w-full text-left px-4 py-3 border-b border-border/20 hover:bg-muted/50 transition-colors flex gap-3 items-start",
                    !n.readAt && "bg-primary/5"
                  )}
                >
                  <div
                    className={cn(
                      "mt-1.5 size-2 rounded-full shrink-0",
                      n.readAt ? "bg-transparent" : "bg-primary"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      {NOTIFICATION_LABELS[n.type] || n.type}
                    </p>
                    <p className="text-sm font-medium truncate">{n.title}</p>
                    {n.message && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {stripMarkdown(n.message)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      {timeAgo(n.createdAt)}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-border/30 px-4 py-2">
            <button
              onClick={() => {
                setOpen(false);
                router.push(allHref);
              }}
              className="text-xs text-primary hover:underline w-full text-center"
            >
              View all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
