"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ScrollableTable,
} from "@/components/ui/table";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UserPlus,
  ClipboardCheck,
  RefreshCw,
  MessageSquarePlus,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Minus,
  CreditCard,
  ShoppingCart,
  Receipt,
  Send,
  Loader2,
} from "lucide-react";
import { getActivePlans, getActiveLocations, submitRenewal } from "@/lib/actions/renewals";
import { getRevenueChartAction } from "@/lib/actions/revenue";
import { ActionList } from "./action-list";

const RevenueChart = dynamic(
  () => import("./revenue-chart").then((m) => ({ default: m.RevenueChart })),
  {
    ssr: false,
    loading: () => (
      <Card className="gradient-border-card bg-card/70 dark:bg-card/80 backdrop-blur-sm">
        <CardHeader><CardTitle>Revenue (Last 7 Days)</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-64 w-full" /></CardContent>
      </Card>
    ),
  }
);

const AttendanceAndStaffSection = dynamic(
  () => import("./attendance-chart").then((m) => ({ default: m.AttendanceAndStaffSection })),
  {
    ssr: false,
    loading: () => (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card><CardContent><Skeleton className="h-48 w-full" /></CardContent></Card>
        <Card><CardContent><Skeleton className="h-48 w-full" /></CardContent></Card>
      </div>
    ),
  }
);

type ExpiringTicket = {
  id: number;
  userId: number;
  userName: string;
  userEmail: string;
  planName: string;
  planId: number;
  locationId: number | null;
  expireDate: string;
};

type RevenueChartItem = {
  date: string;
  cash: number;
  upi: number;
  other: number;
};

type OverdueMember = {
  userId: number;
  name: string;
  phone: string;
  expiredSince: string;
  lastPlan: string;
  lastPlanId: number;
};

type CurrentlyInGymMember = {
  name: string;
  checkInTime: string;
};

type PlanDistItem = {
  planName: string;
  activeCount: number;
};

type BirthdayItem = {
  id: number;
  name: string;
  phone: string;
};

type UpcomingBirthdayItem = {
  id: number;
  name: string;
  phone: string;
  daysUntil: number;
};

type ProfitLossData = {
  revenue: number;
  expenses: number;
  netProfitLoss: number;
};

type TodayCounts = {
  prospects: number;
  followups: number;
  renewals: number;
  newMembers: number;
};


type AnniversaryItem = {
  id: number;
  name: string;
  phone: string;
};

type UpcomingAnniversaryItem = {
  id: number;
  name: string;
  phone: string;
  daysUntil: number;
};

type TargetProgressData = {
  target: { targetRevenue: number; targetNewMembers: number; targetRenewals: number } | null;
  actual: { revenue: number; newMembers: number; renewals: number };
  progress: { revenuePercent: number; newMembersPercent: number; renewalsPercent: number } | null;
  daysRemaining: number;
};

type AnnouncementItem = {
  id: number;
  title: string;
  content: string;
  priority: string;
  targetGroup: string;
  locationName: string;
  createdAt: string;
};

type ForecastData = {
  totalExpiring: number;
  totalPotentialRevenue: number;
  likely: { count: number; revenue: number };
  atRisk: { count: number; revenue: number };
  unlikely: { count: number; revenue: number };
};

type Props = {
  forecast: ForecastData;
  stats: {
    activeMembers: number;
    revenueThisMonth: number;
    expiringIn3Days: ExpiringTicket[];
    todayCheckIns: number;
    revenueChartData: RevenueChartItem[];
    totalMembers: number;
    expiredMembers: number;
    cashThisMonth: number;
    upiThisMonth: number;
    currentlyInGym: CurrentlyInGymMember[];
    overdueMembers: OverdueMember[];
    overdueFollowupsCount: number;
    planDistribution: PlanDistItem[];
    todayBirthdays: BirthdayItem[];
    upcomingBirthdays: UpcomingBirthdayItem[];
    profitLoss: ProfitLossData;
    announcements: AnnouncementItem[];
    attendanceChartData: { date: string; count: number }[];
    staffPerformance: { name: string; total: number; renewals: number }[];
    dailyCollection: number;
    posSales: number;
    todayCounts: TodayCounts;
    todayAnniversaries: AnniversaryItem[];
    upcomingAnniversaries: UpcomingAnniversaryItem[];
  };
  previousMonthStats?: {
    activeMembers: number;
    revenue: number;
  };
  locations: { id: number; name: string }[];
  currentLocationId?: number;
  targetProgress: TargetProgressData;
  workerId?: number;
};

const formatINR = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);

const REVENUE_RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "This month", days: 0 },
  { label: "Last month", days: -1 },
  { label: "3 months", days: 90 },
];

function RevenueChartWithRange({
  defaultData,
  locationId,
}: {
  defaultData: RevenueChartItem[];
  locationId?: number;
}) {
  const [selectedRange, setSelectedRange] = useState("7 days");
  const [chartData, setChartData] = useState(defaultData);
  const [loading, startLoading] = useTransition();

  const handleRangeChange = (label: string) => {
    setSelectedRange(label);
    if (label === "7 days") {
      setChartData(defaultData);
      return;
    }

    const now = new Date();
    let start: Date;
    let end: Date;

    const range = REVENUE_RANGES.find((r) => r.label === label);
    if (!range) return;

    if (label === "This month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    } else if (label === "Last month") {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 1);
    } else {
      start = new Date(now);
      start.setDate(start.getDate() - range.days);
      end = new Date(now);
      end.setDate(end.getDate() + 1);
    }

    startLoading(async () => {
      const data = await getRevenueChartAction(
        start.toISOString(),
        end.toISOString(),
        locationId
      );
      setChartData(data);
    });
  };

  const title = loading ? "Loading..." : `Revenue (${selectedRange})`;

  return (
    <RevenueChart
      data={chartData}
      title={title}
      toolbar={
        <div className="flex gap-1 flex-wrap">
          {REVENUE_RANGES.map((r) => (
            <Button
              key={r.label}
              variant={selectedRange === r.label ? "default" : "outline"}
              size="sm"
              className="text-xs h-7"
              onClick={() => handleRangeChange(r.label)}
              disabled={loading}
            >
              {r.label}
            </Button>
          ))}
        </div>
      }
    />
  );
}

export function DashboardClient({
  stats,
  forecast,
  previousMonthStats,
  locations,
  currentLocationId,
  targetProgress,
  workerId,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Inline renewal dialog state
  const [renewDialogOpen, setRenewDialogOpen] = useState(false);
  const [renewTarget, setRenewTarget] = useState<{
    userId: number;
    userName: string;
    currentPlan: string;
    planId: number;
    locationId: number | null;
  } | null>(null);
  const [plans, setPlans] = useState<{ id: number; name: string; expireDays: number; price: number; isActive: boolean }[]>([]);
  const [renewLocations, setRenewLocations] = useState<{ id: number; name: string; isActive: boolean }[]>([]);
  const [renewPlanId, setRenewPlanId] = useState("");
  const [renewLocationId, setRenewLocationId] = useState("");
  const [renewPaymentMode, setRenewPaymentMode] = useState("cash");
  const [renewUpiRef, setRenewUpiRef] = useState("");
  const [renewResult, setRenewResult] = useState<{
    success?: boolean;
    idempotent?: boolean;
    paymentId?: number;
    invoiceNumber?: string | null;
    newExpiryDate?: Date | string | null;
    error?: string;
  } | null>(null);

  const openRenewDialog = (target: typeof renewTarget) => {
    setRenewTarget(target);
    setRenewPlanId(target?.planId ? String(target.planId) : "");
    setRenewLocationId(target?.locationId ? String(target.locationId) : "");
    setRenewPaymentMode("cash");
    setRenewUpiRef("");
    setRenewResult(null);
    setRenewDialogOpen(true);
    // Load plans/locations if not already loaded
    if (plans.length === 0) {
      startTransition(async () => {
        const [p, l] = await Promise.all([getActivePlans(), getActiveLocations()]);
        setPlans(p);
        setRenewLocations(l);
        // Re-set location if we have one and list just loaded
        if (target?.locationId) setRenewLocationId(String(target.locationId));
        else if (l.length > 0) setRenewLocationId(String(l[0].id));
      });
    }
  };

  const handleRenewSubmit = () => {
    if (!renewTarget || !renewPlanId || !renewLocationId) return;
    startTransition(async () => {
      const res = await submitRenewal({
        userId: renewTarget.userId,
        planId: parseInt(renewPlanId, 10),
        locationId: parseInt(renewLocationId, 10),
        paymentMode: renewPaymentMode,
        upiReference: renewPaymentMode === "upi" ? renewUpiRef : undefined,
      });
      setRenewResult(res);
    });
  };

  const [actionExpanded, setActionExpanded] = useState(true);

  // WhatsApp wish dialog state
  const [wishDialogOpen, setWishDialogOpen] = useState(false);
  const [wishTarget, setWishTarget] = useState<{
    name: string;
    phone: string;
    kind: "birthday" | "anniversary";
  } | null>(null);
  const [wishMessage, setWishMessage] = useState("");

  const openWishDialog = (target: {
    name: string;
    phone: string;
    kind: "birthday" | "anniversary";
  }) => {
    const firstName = target.name.split(" ")[0];
    const defaultMessage =
      target.kind === "birthday"
        ? `Happy Birthday ${firstName}! Wishing you a great year ahead from our gym.`
        : `Happy Anniversary ${firstName}! Wishing you many more happy years ahead from our gym.`;
    setWishTarget(target);
    setWishMessage(defaultMessage);
    setWishDialogOpen(true);
  };

  const handleSendWish = () => {
    if (!wishTarget) return;
    const phone = wishTarget.phone.replace(/\D/g, "");
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(wishMessage)}`;
    window.open(url, "_blank");
    setWishDialogOpen(false);
  };

  // Action required counts
  const overdueCount = stats.overdueFollowupsCount;
  const expiringCount = stats.expiringIn3Days.length;
  const totalActionItems = overdueCount + expiringCount;

  // Trend calculations
  const membersTrend = previousMonthStats
    ? previousMonthStats.activeMembers > 0
      ? Math.round(
          ((stats.activeMembers - previousMonthStats.activeMembers) /
            previousMonthStats.activeMembers) *
            100
        )
      : null
    : null;
  const revenueTrend = previousMonthStats
    ? previousMonthStats.revenue > 0
      ? Math.round(
          ((stats.revenueThisMonth - previousMonthStats.revenue) /
            previousMonthStats.revenue) *
            100
        )
      : null
    : null;

  function handleLocationChange(value: string | null) {
    if (!value || value === "all") {
      router.push("/admin/dashboard");
    } else {
      router.push(`/admin/dashboard?locationId=${value}`);
    }
  }

  return (
    <div className="space-y-4 md:space-y-6 min-w-0">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4">
        <h1 className="text-xl md:text-2xl font-bold">Dashboard</h1>
        {locations.length > 1 ? (
          <Select
            value={currentLocationId ? String(currentLocationId) : "all"}
            onValueChange={handleLocationChange}
          >
            <SelectTrigger>
              <SelectValue placeholder="All locations">
                {currentLocationId
                  ? locations.find((l) => l.id === currentLocationId)?.name ?? "All Locations"
                  : "All Locations"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Locations</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : locations.length === 1 ? (
          <span className="text-sm text-muted-foreground">{locations[0].name}</span>
        ) : null}
      </div>

      {/* Today's Priorities (AI-powered action list) */}
      <ActionList workerId={workerId} />

      {/* Action Required */}
      {totalActionItems > 0 && (
        <Card className="gradient-border-card bg-card/70 dark:bg-card/80">
          <CardHeader
            className="cursor-pointer"
            role="button"
            tabIndex={0}
            aria-expanded={actionExpanded}
            aria-controls="action-required-content"
            onClick={() => setActionExpanded((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActionExpanded((v) => !v);
              }
            }}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlertTriangle className="size-4 text-status-grace" />
                Action Required
                <Badge variant="destructive" className="ml-1">{totalActionItems}</Badge>
              </CardTitle>
              {actionExpanded ? (
                <ChevronUp className="size-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          {actionExpanded && (
            <CardContent id="action-required-content">
              <div className="flex flex-wrap gap-4">
                {overdueCount > 0 && (
                  <Link href="/admin/followups?status=pending">
                    <div className="flex items-center gap-2 rounded-lg border border-status-expired/30 bg-status-expired-bg px-3 py-2 text-xs sm:text-sm hover:bg-status-expired-bg/80 transition-colors">
                      <Badge variant="destructive">{overdueCount}</Badge>
                      <span>overdue payments</span>
                    </div>
                  </Link>
                )}
                {expiringCount > 0 && (
                  <Link href="/admin/members?status=expiring">
                    <div className="flex items-center gap-2 rounded-lg border border-status-expiring/30 bg-status-expiring-bg px-3 py-2 text-xs sm:text-sm hover:bg-status-expiring-bg/80 transition-colors">
                      <Badge variant="secondary">{expiringCount}</Badge>
                      <span>expiring in 3 days</span>
                    </div>
                  </Link>
                )}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Quick Actions */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/members">
              <Button variant="outline" size="sm" className="gap-2 glow-btn hover:scale-[1.02] transition-transform">
                <UserPlus className="size-4" />
                New Member
              </Button>
            </Link>
            <Link href="/admin/attendance">
              <Button variant="outline" size="sm" className="gap-2 glow-btn hover:scale-[1.02] transition-transform">
                <ClipboardCheck className="size-4" />
                Quick Check-in
              </Button>
            </Link>
            <Link href="/admin/renewals">
              <Button variant="outline" size="sm" className="gap-2 glow-btn hover:scale-[1.02] transition-transform">
                <RefreshCw className="size-4" />
                Renew
              </Button>
            </Link>
            <Link href="/admin/enquiries">
              <Button variant="outline" size="sm" className="gap-2 glow-btn hover:scale-[1.02] transition-transform">
                <MessageSquarePlus className="size-4" />
                New Enquiry
              </Button>
            </Link>
            <Link href="/admin/balance-due">
              <Button variant="outline" size="sm" className="gap-2 glow-btn hover:scale-[1.02] transition-transform">
                <CreditCard className="size-4" />
                Record Payment
              </Button>
            </Link>
            <Link href="/admin/pos">
              <Button variant="outline" size="sm" className="gap-2 glow-btn hover:scale-[1.02] transition-transform">
                <ShoppingCart className="size-4" />
                POS Sale
              </Button>
            </Link>
            <Link href="/admin/expenses">
              <Button variant="outline" size="sm" className="gap-2 glow-btn hover:scale-[1.02] transition-transform">
                <Receipt className="size-4" />
                Add Expense
              </Button>
            </Link>
            <Link href="/admin/bulk-notify">
              <Button variant="outline" size="sm" className="gap-2 glow-btn hover:scale-[1.02] transition-transform">
                <Send className="size-4" />
                Bulk Notify
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Announcements */}
      {stats.announcements.length > 0 && (
        <div className="space-y-2">
          {stats.announcements.map((a) => (
            <div
              key={a.id}
              className={`rounded-md border px-4 py-3 text-sm ${
                a.priority === "urgent"
                  ? "border-status-expired/30 bg-status-expired-bg text-status-expired-foreground"
                  : a.priority === "high"
                  ? "border-status-expiring/30 bg-status-expiring-bg text-status-expiring-foreground"
                  : "border-status-info/30 bg-status-info-bg text-status-info-foreground"
              }`}
            >
              <p className="font-semibold">{a.title}</p>
              <p className="mt-1">{a.content}</p>
            </div>
          ))}
        </div>
      )}

      {/* Today's Counts Row */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Card className="glass">
          <CardContent className="pt-4 pb-3 px-3">
            <p className="text-xs text-muted-foreground">New Prospects</p>
            <p className="text-lg font-bold">{stats.todayCounts.prospects}</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="pt-4 pb-3 px-3">
            <p className="text-xs text-muted-foreground">Follow-ups</p>
            <p className="text-lg font-bold">{stats.todayCounts.followups}</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="pt-4 pb-3 px-3">
            <p className="text-xs text-muted-foreground">Renewals</p>
            <p className="text-lg font-bold">{stats.todayCounts.renewals}</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardContent className="pt-4 pb-3 px-3">
            <p className="text-xs text-muted-foreground">New Members</p>
            <p className="text-lg font-bold">{stats.todayCounts.newMembers}</p>
          </CardContent>
        </Card>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
        <Link href="/admin/members?status=active" className="cursor-pointer">
        <Card className="gradient-border-card card-hover-lift shine">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Active Members
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl sm:text-2xl lg:text-3xl font-bold stat-value-glow">{stats.activeMembers}</p>
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              {membersTrend !== null ? (
                <>
                  {membersTrend > 0 ? (
                    <TrendingUp className="size-3 text-financial-positive" />
                  ) : membersTrend < 0 ? (
                    <TrendingDown className="size-3 text-financial-negative" />
                  ) : (
                    <Minus className="size-3" />
                  )}
                  <span className={membersTrend > 0 ? "text-financial-positive" : membersTrend < 0 ? "text-financial-negative" : ""}>
                    {membersTrend > 0 ? "+" : ""}{membersTrend}%
                  </span>
                  <span>vs last month</span>
                </>
              ) : (
                <span>vs last month</span>
              )}
            </div>
          </CardContent>
        </Card>
        </Link>

        <Card className="gradient-border-card card-hover-lift shine">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Revenue This Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl sm:text-2xl lg:text-3xl font-bold stat-value-glow">
              {new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: "INR",
                maximumFractionDigits: 0,
              }).format(stats.revenueThisMonth)}
            </p>
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              {revenueTrend !== null ? (
                <>
                  {revenueTrend > 0 ? (
                    <TrendingUp className="size-3 text-financial-positive" />
                  ) : revenueTrend < 0 ? (
                    <TrendingDown className="size-3 text-financial-negative" />
                  ) : (
                    <Minus className="size-3" />
                  )}
                  <span className={revenueTrend > 0 ? "text-financial-positive" : revenueTrend < 0 ? "text-financial-negative" : ""}>
                    {revenueTrend > 0 ? "+" : ""}{revenueTrend}%
                  </span>
                  <span>vs last month</span>
                </>
              ) : (
                <span>vs last month</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Link href="/admin/members?status=expiring" className="cursor-pointer">
        <Card className="gradient-border-card card-hover-lift shine">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Expiring Soon
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl sm:text-2xl lg:text-3xl font-bold stat-value-glow">
              {stats.expiringIn3Days.length}
            </p>
          </CardContent>
        </Card>
        </Link>

        <Link href="/admin/attendance" className="cursor-pointer">
        <Card className="gradient-border-card card-hover-lift shine">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Today&apos;s Check-ins
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl sm:text-2xl lg:text-3xl font-bold stat-value-glow">{stats.todayCheckIns}</p>
          </CardContent>
        </Card>
        </Link>

        <Link href="/admin/members?status=expired" className="cursor-pointer">
        <Card className="gradient-border-card card-hover-lift shine">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Expired Members
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl sm:text-2xl lg:text-3xl font-bold stat-value-glow">{stats.expiredMembers}</p>
          </CardContent>
        </Card>
        </Link>

        <Card className="gradient-border-card card-hover-lift shine">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Total Members
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl sm:text-2xl lg:text-3xl font-bold stat-value-glow">{stats.totalMembers}</p>
          </CardContent>
        </Card>

        <Card className="gradient-border-card card-hover-lift shine">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Cash / UPI This Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg sm:text-xl lg:text-2xl font-bold">
              {new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: "INR",
                maximumFractionDigits: 0,
              }).format(stats.cashThisMonth)}
              {" / "}
              {new Intl.NumberFormat("en-IN", {
                style: "currency",
                currency: "INR",
                maximumFractionDigits: 0,
              }).format(stats.upiThisMonth)}
            </p>
          </CardContent>
        </Card>

        <Link href="/admin/attendance" className="cursor-pointer">
        <Card className="gradient-border-card card-hover-lift shine">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Currently in Gym
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl sm:text-2xl lg:text-3xl font-bold stat-value-glow">{stats.currentlyInGym.length}</p>
          </CardContent>
        </Card>
        </Link>

        <Card className="gradient-border-card card-hover-lift shine">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Today&apos;s Collection
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl sm:text-2xl lg:text-3xl font-bold stat-value-glow">{formatINR(stats.dailyCollection)}</p>
          </CardContent>
        </Card>

        <Card className="gradient-border-card card-hover-lift shine">
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              POS Sales
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl sm:text-2xl lg:text-3xl font-bold stat-value-glow">{formatINR(stats.posSales)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Profit/Loss Card */}
      <Card className="gradient-border-card bg-card/70 dark:bg-card/80 backdrop-blur-sm">
        <CardHeader>
          <CardTitle>Profit / Loss (This Month)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-sm text-muted-foreground">Revenue</p>
              <p className="text-xl font-bold text-financial-positive">
                {new Intl.NumberFormat("en-IN", {
                  style: "currency",
                  currency: "INR",
                  maximumFractionDigits: 0,
                }).format(stats.profitLoss.revenue)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Expenses</p>
              <p className="text-xl font-bold text-financial-negative">
                {new Intl.NumberFormat("en-IN", {
                  style: "currency",
                  currency: "INR",
                  maximumFractionDigits: 0,
                }).format(stats.profitLoss.expenses)}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Net P/L</p>
              <p
                className={`text-xl font-bold ${
                  stats.profitLoss.netProfitLoss >= 0
                    ? "text-financial-positive"
                    : "text-financial-negative"
                }`}
              >
                {new Intl.NumberFormat("en-IN", {
                  style: "currency",
                  currency: "INR",
                  maximumFractionDigits: 0,
                }).format(stats.profitLoss.netProfitLoss)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Club Targets */}
      {targetProgress.target && targetProgress.progress && (
        <Card className="gradient-border-card bg-card/70 dark:bg-card/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Club Targets (This Month)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Revenue</span>
                  <span>
                    {formatINR(targetProgress.actual.revenue)} / {formatINR(targetProgress.target.targetRevenue)}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(targetProgress.progress.revenuePercent, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">{targetProgress.progress.revenuePercent}% achieved</p>
              </div>
              {targetProgress.target.targetNewMembers > 0 && (
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-muted-foreground">New Members</span>
                    <span>{targetProgress.actual.newMembers} / {targetProgress.target.targetNewMembers}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.min(targetProgress.progress.newMembersPercent, 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{targetProgress.progress.newMembersPercent}% achieved</p>
                </div>
              )}
              {targetProgress.target.targetRenewals > 0 && (
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-muted-foreground">Renewals</span>
                    <span>{targetProgress.actual.renewals} / {targetProgress.target.targetRenewals}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.min(targetProgress.progress.renewalsPercent, 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{targetProgress.progress.renewalsPercent}% achieved</p>
                </div>
              )}
              <p className="text-xs text-muted-foreground text-right">{targetProgress.daysRemaining} day{targetProgress.daysRemaining !== 1 ? "s" : ""} remaining</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue Forecast (Next 30 Days) */}
      {forecast.totalExpiring > 0 && (
        <Card className="gradient-border-card bg-card/70 dark:bg-card/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Revenue Forecast (Next 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">{forecast.totalExpiring} members expiring</p>
                <p className="text-xl md:text-2xl font-bold">
                  {formatINR(forecast.totalPotentialRevenue)}
                  <span className="text-sm font-normal text-muted-foreground ml-1">if all renew</span>
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-green-500" />
                    Likely ({forecast.likely.count})
                  </span>
                  <span className="font-medium">{formatINR(forecast.likely.revenue)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-yellow-500" />
                    At Risk ({forecast.atRisk.count})
                  </span>
                  <span className="font-medium">{formatINR(forecast.atRisk.revenue)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-red-500" />
                    Unlikely ({forecast.unlikely.count})
                  </span>
                  <span className="font-medium">{formatINR(forecast.unlikely.revenue)}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue Bar Chart with Date Range Selector */}
      <RevenueChartWithRange
        defaultData={stats.revenueChartData}
        locationId={currentLocationId}
      />

      {/* Attendance Trend (30 Days) + Staff Leaderboard */}
      <AttendanceAndStaffSection
        attendanceChartData={stats.attendanceChartData}
        staffPerformance={stats.staffPerformance}
      />

      {/* Expiring Members Table */}
      {stats.expiringIn3Days.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Expiring in 3 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollableTable maxHeight="300px">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead className="hidden sm:table-cell">Email</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.expiringIn3Days.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>{t.userName}</TableCell>
                      <TableCell className="max-w-32 truncate hidden sm:table-cell">{t.userEmail}</TableCell>
                      <TableCell>{t.planName}</TableCell>
                      <TableCell>
                        <Badge variant="destructive">
                          {new Date(t.expireDate).toLocaleDateString("en-IN")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openRenewDialog({
                            userId: t.userId,
                            userName: t.userName,
                            currentPlan: t.planName,
                            planId: t.planId,
                            locationId: t.locationId,
                          })}
                        >
                          Renew
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollableTable>
          </CardContent>
        </Card>
      )}
      {/* Who's in Gym Right Now */}
      <Card>
        <CardHeader>
          <CardTitle>Who&apos;s in Gym Right Now</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.currentlyInGym.length === 0 ? (
            <p className="text-muted-foreground">No one currently in the gym.</p>
          ) : (
            <ScrollableTable maxHeight="250px">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Check-in Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.currentlyInGym.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell>{m.name}</TableCell>
                      <TableCell>
                        {new Date(m.checkInTime).toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollableTable>
          )}
        </CardContent>
      </Card>

      {/* Overdue Members */}
      {stats.overdueMembers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Overdue Members</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollableTable maxHeight="300px">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Expired Since</TableHead>
                    <TableHead>Last Plan</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.overdueMembers.map((m) => (
                    <TableRow key={m.userId}>
                      <TableCell>{m.name}</TableCell>
                      <TableCell>{m.phone}</TableCell>
                      <TableCell>
                        <Badge variant="destructive">
                          {new Date(m.expiredSince).toLocaleDateString("en-IN")}
                        </Badge>
                      </TableCell>
                      <TableCell>{m.lastPlan}</TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openRenewDialog({
                            userId: m.userId,
                            userName: m.name,
                            currentPlan: m.lastPlan,
                            planId: m.lastPlanId,
                            locationId: null,
                          })}
                        >
                          Renew
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollableTable>
          </CardContent>
        </Card>
      )}

      {/* Birthdays */}
      {(stats.todayBirthdays.length > 0 || stats.upcomingBirthdays.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Birthdays</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[300px] overflow-y-auto">
            {stats.todayBirthdays.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-medium mb-2">Today</p>
                {stats.todayBirthdays.map((b) => (
                  <div key={b.id} className="flex items-center justify-between py-1">
                    <span className="text-sm">{b.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">{b.phone}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Send birthday wish to ${b.name}`}
                        onClick={() => openWishDialog({ name: b.name, phone: b.phone, kind: "birthday" })}
                      >
                        Send Wish
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {stats.upcomingBirthdays.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Upcoming (7 days)</p>
                {stats.upcomingBirthdays.map((b) => (
                  <div key={b.id} className="flex items-center justify-between py-1">
                    <span className="text-sm">{b.name}</span>
                    <Badge variant="secondary">in {b.daysUntil} day{b.daysUntil > 1 ? "s" : ""}</Badge>
                  </div>
                ))}
              </div>
            )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Anniversaries */}
      {(stats.todayAnniversaries.length > 0 || stats.upcomingAnniversaries.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Anniversaries</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[300px] overflow-y-auto">
            {stats.todayAnniversaries.length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-medium mb-2">Today</p>
                {stats.todayAnniversaries.map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-1">
                    <span className="text-sm">{a.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">{a.phone}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Send anniversary wish to ${a.name}`}
                        onClick={() => openWishDialog({ name: a.name, phone: a.phone, kind: "anniversary" })}
                      >
                        Send Wish
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {stats.upcomingAnniversaries.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Upcoming (7 days)</p>
                {stats.upcomingAnniversaries.map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-1">
                    <span className="text-sm">{a.name}</span>
                    <Badge variant="secondary">in {a.daysUntil} day{a.daysUntil > 1 ? "s" : ""}</Badge>
                  </div>
                ))}
              </div>
            )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plan Distribution */}
      {stats.planDistribution.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Plan Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[250px] overflow-y-auto space-y-2">
              {stats.planDistribution.map((p) => (
                <div key={p.planName} className="flex items-center justify-between">
                  <span className="text-sm">{p.planName}</span>
                  <Badge variant="secondary">{p.activeCount} active</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* WhatsApp Wish Dialog */}
      <Dialog open={wishDialogOpen} onOpenChange={setWishDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {wishTarget?.kind === "anniversary" ? "Send Anniversary Wish" : "Send Birthday Wish"}
            </DialogTitle>
          </DialogHeader>
          {wishTarget && (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Recipient</Label>
                <p className="text-sm font-medium">{wishTarget.name}</p>
                <p className="text-xs text-muted-foreground">{wishTarget.phone}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="wish-message">Message</Label>
                <Textarea
                  id="wish-message"
                  value={wishMessage}
                  onChange={(e) => setWishMessage(e.target.value)}
                  rows={4}
                />
              </div>
            </div>
          )}
          <DialogFooter showCloseButton>
            <Button onClick={handleSendWish} disabled={!wishMessage.trim()}>
              Send via WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inline Renewal Dialog */}
      <Dialog open={renewDialogOpen} onOpenChange={setRenewDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Renew Membership</DialogTitle>
          </DialogHeader>
          {renewTarget && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">{renewTarget.userName}</p>
                <p className="text-xs text-muted-foreground">Current plan: {renewTarget.currentPlan}</p>
              </div>

              {/* Plan */}
              <div className="space-y-1">
                <Label htmlFor="renew-plan">Plan</Label>
                <select
                  id="renew-plan"
                  value={renewPlanId}
                  onChange={(e) => setRenewPlanId(e.target.value)}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
                  required
                >
                  <option value="">Select plan...</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} - {p.expireDays} days - Rs.{p.price}
                    </option>
                  ))}
                </select>
              </div>

              {/* Location */}
              <div className="space-y-1">
                <Label htmlFor="renew-loc">Location</Label>
                <select
                  id="renew-loc"
                  value={renewLocationId}
                  onChange={(e) => setRenewLocationId(e.target.value)}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
                  required
                >
                  <option value="">Select location...</option>
                  {renewLocations.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Payment Mode */}
              <div className="space-y-1">
                <Label htmlFor="renew-pay">Payment Mode</Label>
                <select
                  id="renew-pay"
                  value={renewPaymentMode}
                  onChange={(e) => setRenewPaymentMode(e.target.value)}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                </select>
              </div>

              {/* UPI Reference */}
              {renewPaymentMode === "upi" && (
                <div className="space-y-1">
                  <Label htmlFor="renew-upi">UPI Reference</Label>
                  <Input
                    id="renew-upi"
                    placeholder="UPI transaction ID..."
                    value={renewUpiRef}
                    onChange={(e) => setRenewUpiRef(e.target.value)}
                  />
                </div>
              )}

              {/* Result */}
              {renewResult && (
                <div className="p-3 border rounded-md space-y-1">
                  {renewResult.error ? (
                    <p className="text-sm text-destructive">{renewResult.error}</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-status-active-foreground">
                        Renewal {renewResult.idempotent ? "(duplicate - returning existing)" : "successful"}
                      </p>
                      {renewResult.invoiceNumber && (
                        <p className="text-sm text-muted-foreground">Invoice: {renewResult.invoiceNumber}</p>
                      )}
                      {renewResult.newExpiryDate && (
                        <p className="text-sm text-muted-foreground">
                          New Expiry: {new Date(renewResult.newExpiryDate).toLocaleDateString("en-IN")}
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter showCloseButton>
            {!renewResult?.success && (
              <Button
                onClick={handleRenewSubmit}
                disabled={isPending || !renewPlanId || !renewLocationId}
              >
                {isPending && <Loader2 className="size-4 animate-spin" />}
                {isPending ? "Processing..." : "Submit Renewal"}
              </Button>
            )}
            {renewResult?.success && (
              <Button
                onClick={() => {
                  setRenewDialogOpen(false);
                  router.refresh();
                }}
              >
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
