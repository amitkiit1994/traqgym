import Link from "next/link";
import { requireTrainer } from "@/lib/auth-guard";
import {
  getMyTodaySessions,
  getMyWeekStats,
  getMyPayouts,
} from "@/lib/services/trainer-self";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CalendarDays,
  CheckCircle2,
  Users,
  IndianRupee,
  Clock,
  Wallet,
} from "lucide-react";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

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

export default async function TrainerDashboardPage() {
  const trainer = await requireTrainer();

  const [todaySessions, weekStats, payouts] = await Promise.all([
    getMyTodaySessions(trainer.workerId),
    getMyWeekStats(trainer.workerId),
    getMyPayouts(trainer.workerId),
  ]);

  const pendingPayouts = payouts.filter((p) => p.status === "pending");
  const pendingPayoutTotal = pendingPayouts.reduce(
    (sum, p) => sum + p.trainerShare,
    0
  );

  const inr = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });

  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Hi, {trainer.name}</h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s your day at a glance.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Card className="card-hover-lift shine">
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <CalendarDays className="size-5 text-blue-500 shrink-0" />
            <div>
              <p className="text-lg font-bold">{todaySessions.length}</p>
              <p className="text-xs text-muted-foreground">Today&apos;s sessions</p>
            </div>
          </CardContent>
        </Card>
        <Card className="card-hover-lift shine">
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <CheckCircle2 className="size-5 text-emerald-500 shrink-0" />
            <div>
              <p className="text-lg font-bold">
                {weekStats.sessionsCompleted}
              </p>
              <p className="text-xs text-muted-foreground">This week done</p>
            </div>
          </CardContent>
        </Card>
        <Card className="card-hover-lift shine">
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <Users className="size-5 text-purple-500 shrink-0" />
            <div>
              <p className="text-lg font-bold">{weekStats.activeClients}</p>
              <p className="text-xs text-muted-foreground">Active clients</p>
            </div>
          </CardContent>
        </Card>
        <Card className="card-hover-lift shine">
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <IndianRupee className="size-5 text-green-500 shrink-0" />
            <div>
              <p className="text-lg font-bold">
                {inr.format(weekStats.estimatedEarnings)}
              </p>
              <p className="text-xs text-muted-foreground">This week earnings</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Today's sessions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base md:text-lg">
            Today&apos;s Sessions
          </CardTitle>
          <Link
            href="/trainer/sessions"
            className="text-xs text-primary hover:underline"
          >
            See all
          </Link>
        </CardHeader>
        <CardContent>
          {todaySessions.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <Clock className="size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">
                No sessions scheduled today.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {todaySessions.map((s) => (
                <Link
                  key={s.id}
                  href={`/trainer/clients/${s.userId}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2 hover:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{s.userName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTime(s.scheduledAt)}
                      {s.userPhone ? ` · ${s.userPhone}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {s.sessionsRemaining} left
                    </span>
                    <Badge variant="outline" className={statusClass(s.status)}>
                      {s.status}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Week summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base md:text-lg">This Week</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Completed</p>
            <p className="text-lg font-semibold">{weekStats.sessionsCompleted}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Scheduled</p>
            <p className="text-lg font-semibold">{weekStats.sessionsScheduled}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">No-shows</p>
            <p className="text-lg font-semibold">{weekStats.sessionsNoShow}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cancelled</p>
            <p className="text-lg font-semibold">{weekStats.sessionsCancelled}</p>
          </div>
        </CardContent>
      </Card>

      {/* Pending payouts summary */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base md:text-lg flex items-center gap-2">
            <Wallet className="size-5 text-amber-500" /> Pending Payouts
          </CardTitle>
          <Link
            href="/trainer/payouts"
            className="text-xs text-primary hover:underline"
          >
            View all
          </Link>
        </CardHeader>
        <CardContent>
          {pendingPayouts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No pending payouts.
            </p>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">
                  {inr.format(pendingPayoutTotal)}
                </p>
                <p className="text-xs text-muted-foreground">
                  across {pendingPayouts.length} period
                  {pendingPayouts.length === 1 ? "" : "s"}
                </p>
              </div>
              <Badge variant="outline" className={statusClass("scheduled")}>
                pending
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
