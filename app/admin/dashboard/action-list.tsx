"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  PhoneCall,
  CreditCard,
  Clock,
  UserMinus,
  Cake,
  CalendarOff,
  Heart,
  Target,
  Sparkles,
} from "lucide-react";
import { fetchDailyActions } from "./actions";

type ActionItem = {
  type: string;
  label: string;
  count: number;
  href: string;
  priority: "high" | "medium" | "low";
  suggestion?: string;
};

const iconMap: Record<string, React.ReactNode> = {
  enquiry_followup: <PhoneCall className="size-4" />,
  payment_followup: <CreditCard className="size-4" />,
  expiring_member: <Clock className="size-4" />,
  inactive_member: <UserMinus className="size-4" />,
  birthday: <Cake className="size-4" />,
  pending_leave: <CalendarOff className="size-4" />,
  anniversary_today: <Heart className="size-4" />,
  target_gap: <Target className="size-4" />,
};

const priorityColors: Record<string, string> = {
  high: "border-destructive/30 bg-destructive/5 text-destructive",
  medium: "border-status-expiring/30 bg-status-expiring-bg text-status-expiring",
  low: "border-primary/20 bg-primary/5 text-primary",
};

export function ActionList({ workerId }: { workerId?: number }) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchDailyActions(workerId).then((data) => {
      setItems(data);
      setLoaded(true);
    });
  }, [workerId]);

  if (!loaded || items.length === 0) return null;

  return (
    <Card className="gradient-border-card bg-card/70 dark:bg-card/80 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="size-4 text-primary" />
          Today&apos;s Priorities
          <Badge variant="outline" className="ml-1 text-xs">
            {items.reduce((sum, i) => sum + i.count, 0)} items
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          {items.map((item) => (
            <Link key={item.type} href={item.href}>
              <div
                className={`flex flex-col gap-1 rounded-lg border px-3 py-2 sm:px-4 sm:py-2.5 text-xs sm:text-sm transition-all hover:scale-[1.02] ${priorityColors[item.priority]}`}
              >
                <div className="flex items-center gap-2">
                  {iconMap[item.type]}
                  <Badge
                    variant={item.priority === "high" ? "destructive" : "secondary"}
                    className="text-xs"
                  >
                    {item.count}
                  </Badge>
                  <span>{item.label}</span>
                </div>
                {item.suggestion && (
                  <p className="text-[10px] sm:text-xs text-muted-foreground pl-6 leading-tight">
                    {item.suggestion}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
