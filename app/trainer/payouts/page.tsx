import { requireTrainer } from "@/lib/auth-guard";
import { getMyPayouts } from "@/lib/services/trainer-self";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wallet, IndianRupee } from "lucide-react";

function statusClass(status: string): string {
  switch (status) {
    case "paid":
      return "bg-status-active-bg text-status-active-foreground border-status-active/30";
    case "pending":
      return "bg-status-expiring-bg text-status-expiring-foreground border-status-expiring/30";
    case "disputed":
      return "bg-status-expired-bg text-status-expired-foreground border-status-expired/30";
    default:
      return "";
  }
}

function formatPeriod(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  // periodEnd is exclusive (start of next month), so subtract a day for display.
  const lastDay = new Date(end);
  lastDay.setDate(lastDay.getDate() - 1);
  if (
    start.getMonth() === lastDay.getMonth() &&
    start.getFullYear() === lastDay.getFullYear()
  ) {
    return start.toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
  }
  return `${start.toLocaleDateString("en-IN", { month: "short", day: "numeric" })} – ${lastDay.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function TrainerPayoutsPage() {
  const trainer = await requireTrainer();
  const payouts = await getMyPayouts(trainer.workerId);

  const inr = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });

  const pendingTotal = payouts
    .filter((p) => p.status === "pending")
    .reduce((sum, p) => sum + p.trainerShare, 0);
  const paidTotal = payouts
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.trainerShare, 0);

  return (
    <div className="space-y-4 p-3 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">Payouts</h1>
        <p className="text-sm text-muted-foreground">
          Read-only view. Contact the gym admin for payout queries.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <Wallet className="size-5 text-status-grace shrink-0" />
            <div>
              <p className="text-lg font-bold">{inr.format(pendingTotal)}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-3 px-4">
            <IndianRupee className="size-5 text-status-active shrink-0" />
            <div>
              <p className="text-lg font-bold">{inr.format(paidTotal)}</p>
              <p className="text-xs text-muted-foreground">Paid (lifetime)</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {payouts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center">
            <Wallet className="size-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              No payout periods computed yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All Periods</CardTitle>
          </CardHeader>
          <CardContent className="p-0 md:p-4">
            <ul className="divide-y divide-border/50">
              {payouts.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 md:px-0 py-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {formatPeriod(p.periodStart, p.periodEnd)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.sessionsCount} session
                      {p.sessionsCount === 1 ? "" : "s"} · gross{" "}
                      {inr.format(p.grossRevenue)}
                      {p.paidAt ? ` · paid ${formatDate(p.paidAt)}` : ""}
                      {p.paymentMode ? ` (${p.paymentMode})` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 sm:justify-end">
                    <div className="text-right">
                      <p className="text-lg font-semibold">
                        {inr.format(p.trainerShare)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        your share
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={statusClass(p.status)}
                    >
                      {p.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
