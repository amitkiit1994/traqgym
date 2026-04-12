"use client";

import { useEffect, useState, useTransition } from "react";
import { getActivityFeed } from "@/lib/actions/activity";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type FeedItem = {
  id: string;
  type: string;
  message: string;
  timestamp: string;
};

const typeIcons: Record<string, string> = {
  checkin: "Check-in",
  payment: "Renewal",
  audit: "System",
};

const typeBg: Record<string, string> = {
  checkin: "bg-status-info-bg border-status-info/30",
  payment: "bg-status-active-bg border-status-active/30",
  audit: "bg-muted border-border",
};

export default function ActivityPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      setItems(await getActivityFeed());
    });
  };

  useEffect(() => { load(); }, []);

  const formatTime = (ts: string) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Activity Feed</h1>
        <Button variant="outline" size="sm" onClick={load} disabled={isPending}>
          {isPending ? "Loading..." : "Refresh"}
        </Button>
      </div>

      <div className="space-y-2 max-w-2xl">
        {items.map((item) => (
          <Card key={item.id} className={`${typeBg[item.type] || ""}`}>
            <CardContent className="py-3 px-4 flex items-start justify-between gap-4">
              <div className="flex-1">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {typeIcons[item.type] || item.type}
                </span>
                <p className="text-sm mt-0.5">{item.message}</p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatTime(item.timestamp)}
              </span>
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && !isPending && (
          <p className="text-center text-muted-foreground py-8">No recent activity</p>
        )}
      </div>
    </div>
  );
}
