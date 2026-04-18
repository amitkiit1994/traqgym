import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getMemberPayments } from "@/lib/actions/payment-history";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CalendarCheck,
  CreditCard,
  Clock,
  TrendingUp,
  Flame,
  Activity,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default async function MemberHomePage() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.actorType !== "member") {
    redirect("/login");
  }

  const userId = parseInt(session.user.id);
  const now = new Date();
  const todayStart = new Date(now.toISOString().split("T")[0]);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  // Fetch all independent data in parallel
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [todayAttendance, tickets, recentAttendanceAll, announcements, activeFreeze, { payments: recentPayments }] = await Promise.all([
    prisma.attendanceLog.findFirst({
      where: {
        userId,
        attendanceDate: { gte: todayStart, lt: todayEnd },
      },
    }),
    prisma.memberTicket.findMany({
      where: { userId },
      include: { plan: { select: { name: true } } },
      orderBy: { buyDate: "desc" },
    }),
    prisma.attendanceLog.findMany({
      where: { userId, attendanceDate: { gte: thirtyDaysAgo } },
      orderBy: { attendanceDate: "desc" },
      include: { location: { select: { name: true } } },
    }),
    prisma.announcement.findMany({
      where: {
        isActive: true,
        targetGroup: { in: ["all", "members"] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.membershipFreeze.findFirst({
      where: { userId, status: "active" },
    }),
    getMemberPayments(userId, { page: 1, pageSize: 5 }),
  ]);

  // Active ticket
  const activeTicket = tickets.find((t) => t.expireDate >= now);

  // Days remaining calculation
  const daysRemaining = activeTicket
    ? Math.ceil((activeTicket.expireDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Attendance streak calculation
  let streak = 0;
  if (recentAttendanceAll.length > 0) {
    const dates = new Set(
      recentAttendanceAll.map((a) => a.attendanceDate.toISOString().split("T")[0])
    );
    const checkDate = new Date(todayStart);
    // If not checked in today, start from yesterday
    if (!todayAttendance) checkDate.setDate(checkDate.getDate() - 1);
    while (dates.has(checkDate.toISOString().split("T")[0])) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }
  }

  // This week attendance dots (Mon-Sun)
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
  const weekDots: boolean[] = [];
  const attendanceDates = new Set(
    recentAttendanceAll.map((a) => a.attendanceDate.toISOString().split("T")[0])
  );
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    weekDots.push(attendanceDates.has(d.toISOString().split("T")[0]));
  }

  // Quick stats
  const visitsThisMonth = recentAttendanceAll.filter((a) => {
    const d = a.attendanceDate;
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  const memberSinceMonths = Math.floor(
    (now.getTime() - (tickets.at(-1)?.buyDate.getTime() || now.getTime())) / (1000 * 60 * 60 * 24 * 30)
  );

  const avgVisitsPerWeek = recentAttendanceAll.length > 0
    ? Math.round((recentAttendanceAll.length / 4) * 10) / 10
    : 0;

  const statusColor = activeTicket
    ? daysRemaining > 30
      ? "text-green-600"
      : daysRemaining > 7
      ? "text-yellow-600"
      : "text-red-600"
    : "text-muted-foreground";

  const statusBorderColor = activeTicket
    ? daysRemaining > 30
      ? "border-green-500/20"
      : daysRemaining > 7
      ? "border-yellow-500/20"
      : "border-red-500/20"
    : "border-muted";

  const inr = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });

  const dayNames = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <div className="space-y-4 md:space-y-6 p-3 md:p-6">
      <h1 className="text-2xl font-bold">Welcome, {session.user.name}</h1>

      {/* Announcements */}
      {announcements.length > 0 && (
        <div className="space-y-2">
          {announcements.map((a) => (
            <Card
              key={a.id}
              className={
                a.priority === "urgent"
                  ? "border-status-expired/30 bg-status-expired-bg"
                  : a.priority === "high"
                  ? "border-status-expiring/30 bg-status-expiring-bg"
                  : "border-status-info/30 bg-status-info-bg"
              }
            >
              <CardContent className="pt-4">
                <p className="font-semibold text-sm">{a.title}</p>
                <p className="text-sm mt-1">{a.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Expiry Warning Banner */}
      {!activeTicket && tickets.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          <p className="font-semibold text-destructive">Your membership has expired.</p>
          <p className="text-muted-foreground mt-1">Contact the front desk to renew and continue your fitness journey.</p>
        </div>
      )}
      {activeTicket && daysRemaining <= 7 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <p className="font-semibold text-destructive">Your membership expires in {daysRemaining} day{daysRemaining !== 1 ? "s" : ""}.</p>
          <p className="text-muted-foreground mt-1">Please visit the front desk to renew your plan.</p>
        </div>
      )}
      {activeTicket && daysRemaining > 7 && daysRemaining <= 30 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 px-4 py-3 text-sm">
          <p className="font-semibold text-yellow-600 dark:text-yellow-500">Your membership expires in {daysRemaining} days.</p>
          <p className="text-muted-foreground mt-1">Consider renewing your plan soon at the front desk.</p>
        </div>
      )}

      {/* Freeze Banner */}
      {activeFreeze && (
        <Card className="border-status-frozen/30">
          <CardHeader>
            <CardTitle className="text-status-frozen-foreground">Membership Frozen</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              Your membership is frozen from{" "}
              {activeFreeze.freezeStart.toLocaleDateString("en-IN")} to{" "}
              {activeFreeze.freezeEnd.toLocaleDateString("en-IN")}.
              {activeFreeze.daysAdded > 0 &&
                ` ${activeFreeze.daysAdded} days will be added to your expiry.`}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Membership Status Hero Card */}
      <Card className={`${statusBorderColor} gradient-border-card shine dark:bg-card/80`}>
        <CardContent className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 py-5">
          <div className="flex flex-col items-center justify-center shrink-0">
            <div className={`text-2xl sm:text-4xl font-bold ${statusColor} stat-value-glow`}>
              {activeTicket ? daysRemaining : 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">days left</div>
          </div>
          <div className="flex-1">
            {activeTicket ? (
              <>
                <p className="font-semibold">{activeTicket.plan.name}</p>
                <p className="text-sm text-muted-foreground">
                  Expires {activeTicket.expireDate.toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
                {daysRemaining <= 7 && (
                  <Badge variant="destructive" className="mt-2">Renew Soon</Badge>
                )}
              </>
            ) : (
              <>
                <p className="font-semibold text-muted-foreground">No Active Membership</p>
                <p className="text-sm text-muted-foreground">Contact the gym to renew</p>
              </>
            )}
          </div>
          <div className="shrink-0">
            {todayAttendance ? (
              <div className="flex items-center gap-1.5">
                <Badge>Checked In</Badge>
                <span className="text-xs text-muted-foreground">
                  {todayAttendance.checkIn.toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ) : (
              <Badge variant="secondary">Not Checked In</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <Card className="card-hover-lift shine">
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <CalendarCheck className="size-5 text-blue-500 shrink-0" />
            <div>
              <p className="text-lg font-bold">{visitsThisMonth}</p>
              <p className="text-xs text-muted-foreground">Visits this month</p>
            </div>
          </CardContent>
        </Card>
        <Card className="card-hover-lift shine">
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <TrendingUp className="size-5 text-green-500 shrink-0" />
            <div>
              <p className="text-lg font-bold">{avgVisitsPerWeek}</p>
              <p className="text-xs text-muted-foreground">Avg visits/week</p>
            </div>
          </CardContent>
        </Card>
        <Card className="card-hover-lift shine">
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <Clock className="size-5 text-purple-500 shrink-0" />
            <div>
              <p className="text-lg font-bold">{memberSinceMonths}</p>
              <p className="text-xs text-muted-foreground">Months as member</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Attendance Streak */}
      <Card className="gradient-border-card dark:bg-card/80">
        <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 py-4 px-4">
          <div className="flex items-center gap-3">
            <Flame className={`size-5 ${streak > 0 ? "text-orange-500" : "text-muted-foreground"}`} />
            <div>
              <p className="text-sm font-medium">
                {streak > 0 ? `${streak}-day streak!` : "No current streak"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {dayNames.map((day, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] text-muted-foreground">{day}</span>
                <div
                  className={`size-6 rounded-full flex items-center justify-center text-[10px] font-medium ${
                    weekDots[i]
                      ? "bg-primary text-primary-foreground dark:shadow-[0_0_8px_oklch(0.65_0.18_275_/_30%)]"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {weekDots[i] ? "\u2713" : ""}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Membership History */}
      <Card>
        <CardHeader>
          <CardTitle>Membership History</CardTitle>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <Activity className="size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No memberships yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {tickets.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between border-b pb-2 last:border-0"
                >
                  <div>
                    <p className="font-medium">{t.plan.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {t.buyDate.toLocaleDateString("en-IN")} &mdash;{" "}
                      {t.expireDate.toLocaleDateString("en-IN")}
                    </p>
                  </div>
                  {activeTicket && activeTicket.id === t.id && (
                    <Badge>Active</Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Payments */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {recentPayments.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <CreditCard className="size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No payments yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentPayments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-sm border-b pb-2 last:border-0"
                >
                  <div>
                    <p className="font-medium">{p.planName}</p>
                    <p className="text-muted-foreground">
                      {new Date(p.date).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <p className="font-medium">{inr.format(p.amount)}</p>
                      <p className="text-muted-foreground">{p.paymentMode}</p>
                    </div>
                    {p.invoiceId && (
                      <a href={`/api/invoices/${p.invoiceId}/pdf`} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <Download className="size-4" />
                          <span className="sr-only">Download invoice</span>
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Attendance */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Attendance</CardTitle>
        </CardHeader>
        <CardContent>
          {recentAttendanceAll.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-center">
              <CalendarCheck className="size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No attendance records</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentAttendanceAll.slice(0, 5).map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between text-sm"
                >
                  <span>
                    {a.attendanceDate.toLocaleDateString("en-IN", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                  <span className="text-muted-foreground">{a.location.name}</span>
                  <span className="text-muted-foreground">
                    {a.checkIn.toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
