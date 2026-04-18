import Link from "next/link";
import { requireTrainer } from "@/lib/auth-guard";
import { getMyUpcomingSessions } from "@/lib/services/trainer-self";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays } from "lucide-react";

function statusClass(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    case "scheduled":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
    case "no_show":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "cancelled":
      return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
    default:
      return "";
  }
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatDayHeading(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.getTime() === today.getTime()) return "Today";
  if (d.getTime() === tomorrow.getTime()) return "Tomorrow";
  return d.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function TrainerSessionsPage() {
  const trainer = await requireTrainer();
  const sessions = await getMyUpcomingSessions(trainer.workerId, 14);

  // Group by day
  const groups = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const key = dayKey(s.scheduledAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const sortedDays = Array.from(groups.keys()).sort();

  return (
    <div className="space-y-4 p-3 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Sessions</h1>
        <p className="text-sm text-muted-foreground">
          Next 14 days · {sessions.length} session
          {sessions.length === 1 ? "" : "s"}
        </p>
      </div>

      {sessions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center">
            <CalendarDays className="size-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              No sessions scheduled in the next 14 days.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sortedDays.map((day) => {
            const items = groups.get(day)!;
            return (
              <Card key={day}>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-semibold flex items-center justify-between">
                    <span>{formatDayHeading(day)}</span>
                    <span className="text-xs text-muted-foreground font-normal">
                      {items.length} session{items.length === 1 ? "" : "s"}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ul className="divide-y divide-border/50">
                    {items.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/trainer/clients/${s.userId}`}
                          className="flex items-center justify-between gap-3 px-3 md:px-4 py-3 hover:bg-muted/40 transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="text-sm font-mono tabular-nums w-14 shrink-0">
                              {formatTime(s.scheduledAt)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium truncate">
                                {s.userName}
                              </p>
                              {s.userPhone && (
                                <p className="text-xs text-muted-foreground truncate">
                                  {s.userPhone}
                                </p>
                              )}
                            </div>
                          </div>
                          <Badge
                            variant="outline"
                            className={statusClass(s.status)}
                          >
                            {s.status}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
