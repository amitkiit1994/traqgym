"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getMemberInAppNotifications,
  markMemberInAppRead,
  markAllMemberInAppRead,
} from "@/lib/actions/member-notifications";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NOTIFICATION_LABELS } from "@/lib/notification-types";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils/format";

type Notification = {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  readAt: Date | string | null;
  createdAt: Date | string;
};

export default function MemberInAppNotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(0);
  const [isPending, startTransition] = useTransition();
  const perPage = 20;

  const load = (offset = 0) => {
    startTransition(async () => {
      const data = await getMemberInAppNotifications(perPage, offset);
      setNotifications(data.notifications as Notification[]);
      setUnreadCount(data.unreadCount);
    });
  };

  useEffect(() => {
    load(page * perPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const handleClick = (notif: Notification) => {
    if (!notif.readAt) {
      startTransition(async () => {
        await markMemberInAppRead(notif.id);
        setUnreadCount((c) => Math.max(0, c - 1));
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notif.id ? { ...n, readAt: new Date().toISOString() } : n
          )
        );
      });
    }
    if (notif.link) {
      router.push(notif.link);
    }
  };

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllMemberInAppRead();
      setUnreadCount(0);
      setNotifications((prev) =>
        prev.map((n) => ({
          ...n,
          readAt: n.readAt || new Date().toISOString(),
        }))
      );
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Alerts</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0
              ? `${unreadCount} unread`
              : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={isPending}
          >
            Mark All Read
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0 divide-y divide-border/30">
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              No notifications yet
            </p>
          ) : (
            notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={cn(
                  "w-full text-left px-5 py-4 hover:bg-muted/50 transition-colors flex gap-3 items-start",
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
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {NOTIFICATION_LABELS[n.type] || n.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground/70">
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm font-medium mt-1">{n.title}</p>
                  {n.message && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {n.message}
                    </p>
                  )}
                </div>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {notifications.length >= perPage && (
        <div className="flex justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || isPending}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={notifications.length < perPage || isPending}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
