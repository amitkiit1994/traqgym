"use client";

import { useState, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type Trainer = {
  id: number;
  firstname: string;
  lastname: string;
  email: string;
  role: string;
  isActive: boolean;
  isExternal: boolean;
  defaultGymCutPct: number;
  ownTrainerCutPct: number;
};

type Stats = {
  activePackages: number;
  totalSessionsThisMonth: number;
  sessionsByStatus: { scheduled: number; completed: number; no_show: number; cancelled: number };
  clientCount: number;
  revenueGenerated: number;
  commissionEarned: number;
};

type Client = {
  userId: number;
  userName: string;
  userPhone: string | null;
  packageId: number;
  sessionsTotal: number;
  sessionsUsed: number;
  sessionsRemaining: number;
  lastSessionAt: string | null;
};

type Payout = {
  id: number;
  trainerId: number;
  periodStart: string;
  periodEnd: string;
  sessionsCount: number;
  grossRevenue: number;
  gymShare: number;
  trainerShare: number;
  paidAt: string | null;
  paymentMode: string | null;
  status: string;
};

type SessionRow = {
  id: number;
  packageId: number;
  memberName: string;
  scheduledAt: string;
  completedAt: string | null;
  status: string;
  notes: string | null;
  pricePerSession: number;
};

function statusBadgeClass(status: string) {
  switch (status) {
    case "active":
    case "completed":
    case "paid":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    case "scheduled":
    case "pending":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
    case "no_show":
    case "expired":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "cancelled":
      return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
    default:
      return "";
  }
}

export function TrainerDetailClient({
  trainer,
  stats,
  clients,
  payouts,
  recentSessions,
  currentPeriod,
}: {
  trainer: Trainer;
  stats: Stats;
  clients: Client[];
  payouts: Payout[];
  recentSessions: SessionRow[];
  currentPeriod: { month: number; year: number };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [computeError, setComputeError] = useState("");
  const [markPayout, setMarkPayout] = useState<Payout | null>(null);
  const [paymentMode, setPaymentMode] = useState("upi");
  const [paidAt, setPaidAt] = useState("");
  const [markError, setMarkError] = useState("");

  const handleComputeLastMonth = useCallback(() => {
    setComputeError("");
    let month = currentPeriod.month - 1;
    let year = currentPeriod.year;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
    startTransition(async () => {
      const { computeMonthlyPayoutAction } = await import(
        "@/lib/actions/trainer-payout"
      );
      const result = await computeMonthlyPayoutAction({
        trainerId: trainer.id,
        month,
        year,
      });
      if (result.success) {
        router.refresh();
      } else {
        setComputeError(result.error);
      }
    });
  }, [trainer.id, currentPeriod, router]);

  const openMarkDialog = (p: Payout) => {
    setMarkPayout(p);
    setPaymentMode("upi");
    setPaidAt("");
    setMarkError("");
  };

  const handleMarkPaid = () => {
    if (!markPayout) return;
    setMarkError("");
    startTransition(async () => {
      const { markPayoutPaidAction } = await import(
        "@/lib/actions/trainer-payout"
      );
      const result = await markPayoutPaidAction({
        payoutId: markPayout.id,
        paymentMode,
        paidAt: paidAt || undefined,
      });
      if (result.success) {
        setMarkPayout(null);
        router.refresh();
      } else {
        setMarkError(result.error);
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {trainer.firstname} {trainer.lastname}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{trainer.role}</Badge>
            {trainer.isExternal && (
              <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
                External
              </Badge>
            )}
            {!trainer.isActive && (
              <Badge variant="outline" className="bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30">
                Inactive
              </Badge>
            )}
            <span>{trainer.email}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Trainer share default: {trainer.ownTrainerCutPct}%
            {trainer.isExternal && ` · Gym cut for external: ${trainer.defaultGymCutPct}%`}
          </div>
        </div>
        <Button onClick={handleComputeLastMonth} disabled={isPending}>
          Compute payout for last month
        </Button>
      </div>
      {computeError && <p className="text-xs text-destructive">{computeError}</p>}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Active packages" value={stats.activePackages} />
        <StatCard
          label="Sessions this month"
          value={stats.totalSessionsThisMonth}
          sub={`${stats.sessionsByStatus.completed} completed`}
        />
        <StatCard
          label="Revenue generated"
          value={`₹${stats.revenueGenerated.toLocaleString("en-IN")}`}
        />
        <StatCard
          label="Commission earned"
          value={`₹${stats.commissionEarned.toLocaleString("en-IN")}`}
          sub={`${stats.clientCount} clients`}
        />
      </div>

      {/* Clients */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          PT Clients
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead className="hidden md:table-cell">Last session</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((c) => (
              <TableRow key={c.packageId}>
                <TableCell>
                  <div className="font-medium">{c.userName}</div>
                  {c.userPhone && (
                    <div className="text-xs text-muted-foreground">{c.userPhone}</div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {c.sessionsUsed} / {c.sessionsTotal}
                  <div className="text-xs text-muted-foreground">
                    {c.sessionsRemaining} left
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {c.lastSessionAt ? c.lastSessionAt.split("T")[0] : "—"}
                </TableCell>
              </TableRow>
            ))}
            {clients.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  No active PT clients
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      {/* Recent sessions */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent Sessions
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Notes</TableHead>
              <TableHead className="hidden lg:table-cell">Price</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recentSessions.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="whitespace-nowrap">
                  {s.scheduledAt.replace("T", " ").slice(0, 16)}
                </TableCell>
                <TableCell>{s.memberName}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusBadgeClass(s.status)}>
                    {s.status === "no_show" ? "No Show" : s.status}
                  </Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell max-w-[240px] truncate">
                  {s.notes || "-"}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  ₹{s.pricePerSession.toLocaleString("en-IN")}
                </TableCell>
              </TableRow>
            ))}
            {recentSessions.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No recent sessions
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      {/* Payouts */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Payouts
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead>Gross</TableHead>
              <TableHead className="hidden md:table-cell">Gym share</TableHead>
              <TableHead>Trainer share</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Paid at</TableHead>
              <TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payouts.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="whitespace-nowrap">
                  {p.periodStart.split("T")[0]} → {p.periodEnd.split("T")[0]}
                </TableCell>
                <TableCell>{p.sessionsCount}</TableCell>
                <TableCell>₹{p.grossRevenue.toLocaleString("en-IN")}</TableCell>
                <TableCell className="hidden md:table-cell">
                  ₹{p.gymShare.toLocaleString("en-IN")}
                </TableCell>
                <TableCell className="font-medium">
                  ₹{p.trainerShare.toLocaleString("en-IN")}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={statusBadgeClass(p.status)}>
                    {p.status}
                  </Badge>
                </TableCell>
                <TableCell className="hidden lg:table-cell whitespace-nowrap">
                  {p.paidAt
                    ? `${p.paidAt.split("T")[0]} (${p.paymentMode ?? "—"})`
                    : "—"}
                </TableCell>
                <TableCell>
                  {p.status === "pending" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openMarkDialog(p)}
                      disabled={isPending}
                    >
                      Mark paid
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {payouts.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  No payouts yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      {/* Mark paid dialog */}
      <Dialog open={!!markPayout} onOpenChange={(v) => !v && setMarkPayout(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark payout as paid</DialogTitle>
          </DialogHeader>
          {markPayout && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Period: {markPayout.periodStart.split("T")[0]} → {markPayout.periodEnd.split("T")[0]}
                <br />
                Trainer share: ₹{markPayout.trainerShare.toLocaleString("en-IN")}
              </div>
              <div>
                <Label>Payment mode</Label>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="upi">UPI</option>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              <div>
                <Label>Paid at (optional)</Label>
                <Input
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                  className="mt-1"
                />
              </div>
              {markError && <p className="text-xs text-destructive">{markError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkPayout(null)}>
              Cancel
            </Button>
            <Button onClick={handleMarkPaid} disabled={isPending}>
              {isPending ? "Saving..." : "Mark paid"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
