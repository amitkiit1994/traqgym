"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getWorkerInAppNotifications,
  markWorkerNotificationRead,
  markAllWorkerNotificationsRead,
} from "@/lib/actions/in-app-notifications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NOTIFICATION_LABELS } from "@/lib/notification-types";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import Markdown from "react-markdown";
import { stripMarkdown, timeAgo } from "@/lib/utils/format";

const AI_NOTIFICATION_TYPES = new Set([
  "ai_briefing", "daily_briefing", "churn_alert",
  "lead_followup", "weekly_summary", "member_nudge",
  "milestone", "smart_renewal",
]);

type Notification = {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  readAt: Date | string | null;
  createdAt: Date | string;
};

export default function AdminInAppNotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const perPage = 20;

  const load = (offset = 0) => {
    startTransition(async () => {
      const data = await getWorkerInAppNotifications(perPage, offset);
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
        await markWorkerNotificationRead(notif.id);
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
      await markAllWorkerNotificationsRead();
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
            notifications.map((n) => {
              const isAI = AI_NOTIFICATION_TYPES.has(n.type);
              const isExpanded = expandedId === n.id;

              return (
                <div
                  key={n.id}
                  className={cn(
                    "w-full text-left px-5 py-4 hover:bg-muted/50 transition-colors",
                    !n.readAt && "bg-primary/5"
                  )}
                >
                  <button
                    onClick={() => {
                      if (isAI && n.message) {
                        // Toggle expand for AI notifications
                        setExpandedId(isExpanded ? null : n.id);
                        if (!n.readAt) {
                          startTransition(async () => {
                            await markWorkerNotificationRead(n.id);
                            setUnreadCount((c) => Math.max(0, c - 1));
                            setNotifications((prev) =>
                              prev.map((x) =>
                                x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x
                              )
                            );
                          });
                        }
                      } else {
                        handleClick(n);
                      }
                    }}
                    className="w-full text-left flex gap-3 items-start"
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
                        {isAI && n.message && (
                          <span className="ml-auto text-muted-foreground">
                            {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium mt-1">{n.title}</p>
                      {n.message && !isAI && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {stripMarkdown(n.message)}
                        </p>
                      )}
                      {n.message && isAI && !isExpanded && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          {stripMarkdown(n.message).slice(0, 100)}...
                        </p>
                      )}
                    </div>
                  </button>
                  {isAI && isExpanded && n.message && (
                    <div className="mt-3 ml-5 pl-3 border-l-2 border-primary/20 text-sm text-foreground leading-relaxed ai-markdown">
                      <Markdown>{n.message}</Markdown>
                    </div>
                  )}
                </div>
              );
            })
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
