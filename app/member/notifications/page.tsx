"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getMemberNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/actions/member-notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  MessageSquare,
  Smartphone,
  Mail,
  CheckCheck,
  Circle,
} from "lucide-react";

type Notification = {
  id: number;
  templateName: string;
  channel: string;
  deliveryDate: string;
  sentAt: string | null;
  readAt: string | null;
  createdAt: string;
};

const channelIcons: Record<string, React.ReactNode> = {
  whatsapp: <MessageSquare className="size-4 text-green-600" />,
  sms: <Smartphone className="size-4 text-blue-600" />,
  email: <Mail className="size-4 text-red-600" />,
};

function formatTemplate(name: string) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MemberNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [channelFilter, setChannelFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isPending, startTransition] = useTransition();

  const pageSize = 20;

  const loadData = (p: number) => {
    startTransition(async () => {
      const result = await getMemberNotifications({
        channel: channelFilter === "all" ? undefined : channelFilter,
        limit: pageSize,
        offset: (p - 1) * pageSize,
      });
      setNotifications(result.notifications);
      setUnreadCount(result.unreadCount);
      setHasMore(result.notifications.length === pageSize);
    });
  };

  useEffect(() => {
    setPage(1);
    loadData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelFilter]);

  const handleMarkRead = async (id: number) => {
    await markNotificationRead(id);
    setNotifications((prev) =>
      prev.map((n) => n.id === id ? { ...n, readAt: new Date().toISOString() } : n)
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const handleMarkAllRead = async () => {
    await markAllNotificationsRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })));
    setUnreadCount(0);
    toast.success("All notifications marked as read");
  };

  return (
    <div className="max-w-2xl mx-auto p-3 md:p-6 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Notifications</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-muted-foreground">{unreadCount} unread</p>
          )}
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={handleMarkAllRead}>
            <CheckCheck className="size-3.5 mr-1.5" />
            Mark All Read
          </Button>
        )}
      </div>

      {/* Channel Filter */}
      <div className="flex gap-1">
        {["all", "whatsapp", "sms", "email"].map((c) => (
          <button
            key={c}
            onClick={() => setChannelFilter(c)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-md capitalize ${
              channelFilter === c
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {c !== "all" && channelIcons[c]}
            {c}
          </button>
        ))}
      </div>

      {/* Notification List */}
      <div className="space-y-2">
        {notifications.map((n) => (
          <Card
            key={n.id}
            className={`cursor-pointer transition-colors ${
              !n.readAt ? "border-primary/30 bg-primary/5" : ""
            }`}
            onClick={() => !n.readAt && handleMarkRead(n.id)}
          >
            <CardContent className="flex items-center gap-3 py-3 px-4">
              <div className="shrink-0">
                {!n.readAt ? (
                  <Circle className="size-2.5 fill-primary text-primary" />
                ) : (
                  <Circle className="size-2.5 text-muted-foreground/30" />
                )}
              </div>
              <div className="shrink-0">
                {channelIcons[n.channel] || <Mail className="size-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${!n.readAt ? "font-medium" : ""}`}>
                  {formatTemplate(n.templateName)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(n.createdAt).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
              <Badge variant="outline" className="capitalize shrink-0">
                {n.channel}
              </Badge>
            </CardContent>
          </Card>
        ))}
        {notifications.length === 0 && !isPending && (
          <p className="text-center text-muted-foreground py-8">
            No notifications yet
          </p>
        )}
      </div>

      {/* Pagination */}
      {notifications.length > 0 && (
        <div className="flex items-center gap-2 justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1 || isPending}
            onClick={() => { setPage(page - 1); loadData(page - 1); }}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore || isPending}
            onClick={() => { setPage(page + 1); loadData(page + 1); }}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
