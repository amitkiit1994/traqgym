"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CalendarClock, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  listSchedulesAction,
  cancelScheduleAction,
  getScheduleCountsAction,
} from "@/lib/actions/payment-schedule";
import { CreatePaymentScheduleDialog } from "@/components/admin/create-payment-schedule-dialog";

type Row = Awaited<ReturnType<typeof listSchedulesAction>>["data"][number];

const STATUSES = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "defaulted", label: "Defaulted" },
  { value: "cancelled", label: "Cancelled" },
];

function StatusPill({ status }: { status: string }) {
  const variant: React.ComponentProps<typeof Badge>["variant"] =
    status === "active"
      ? "default"
      : status === "completed"
        ? "secondary"
        : status === "defaulted"
          ? "destructive"
          : "outline";
  return <Badge variant={variant}>{status}</Badge>;
}

type StatusCounts = { active: number; completed: number; defaulted: number; cancelled: number };

export default function PaymentSchedulesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("active");
  const [loading, startLoading] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Row | null>(null);
  const [counts, setCounts] = useState<StatusCounts>({
    active: 0,
    completed: 0,
    defaulted: 0,
    cancelled: 0,
  });

  const reload = () => {
    startLoading(async () => {
      const [result, c] = await Promise.all([
        listSchedulesAction({ status, page: 1, pageSize: 50 }),
        getScheduleCountsAction(),
      ]);
      setRows(result.data);
      setTotal(result.total);
      setCounts(c);
    });
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const countFor = (v: string): number | null => {
    if (v === "all") return counts.active + counts.completed + counts.defaulted + counts.cancelled;
    if (v in counts) return counts[v as keyof StatusCounts];
    return null;
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    const scheduleId = cancelTarget.id;
    setCancellingId(scheduleId);
    const result = await cancelScheduleAction({
      scheduleId,
      reason: "manual cancellation",
    });
    setCancellingId(null);
    setCancelTarget(null);
    if (result.success) {
      toast.success("Schedule cancelled");
      reload();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="shrink-0 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl md:text-2xl font-bold">Payment Schedules</h1>
        <div className="flex items-center gap-2">
          {counts.defaulted > 0 && status !== "defaulted" && (
            <button
              type="button"
              onClick={() => setStatus("defaulted")}
              className="inline-flex items-center gap-1 text-xs"
              title="Show defaulted schedules"
            >
              <Badge variant="destructive">{counts.defaulted} defaulted</Badge>
            </button>
          )}
          <Select value={status} onValueChange={(v) => setStatus(v ?? "active")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => {
                const c = countFor(s.value);
                return (
                  <SelectItem key={s.value} value={s.value}>
                    <span className="inline-flex items-center gap-2">
                      {s.label}
                      {c !== null && (
                        <Badge
                          variant={s.value === "defaulted" && c > 0 ? "destructive" : "secondary"}
                          className="text-[10px]"
                        >
                          {c}
                        </Badge>
                      )}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Schedule
          </Button>
        </div>
      </div>

      <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <CardHeader className="flex-row items-center gap-2 space-y-0">
          <CalendarClock className="size-5 text-primary" />
          <CardTitle className="text-lg">
            {total} {status === "all" ? "schedule" : status} schedule{total !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <p className="text-muted-foreground py-8 text-center">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              No payment schedules found
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="hidden md:table-cell">Plan</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="hidden md:table-cell text-right">
                    Paid so far
                  </TableHead>
                  <TableHead>Next installment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={row.overdueCount > 0 ? "bg-destructive/5" : ""}
                  >
                    <TableCell>
                      <div className="font-medium">{row.memberName}</div>
                      {row.phone && (
                        <div className="text-xs text-muted-foreground">{row.phone}</div>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{row.planName}</TableCell>
                    <TableCell className="text-right font-mono">
                      Rs {row.totalAmount.toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-right font-mono">
                      Rs {row.paidSoFar.toLocaleString("en-IN")}
                    </TableCell>
                    <TableCell>
                      {row.nextDueDate ? (
                        <div className="flex flex-col">
                          <span>
                            Rs {(row.nextDueAmount ?? 0).toLocaleString("en-IN")}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(row.nextDueDate).toLocaleDateString("en-IN")}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <StatusPill status={row.status} />
                        {row.overdueCount > 0 && (
                          <Badge variant="destructive" className="text-[10px]">
                            {row.overdueCount} overdue
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {row.status === "active" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setCancelTarget(row)}
                          disabled={cancellingId === row.id}
                        >
                          {cancellingId === row.id && (
                            <Loader2 className="size-3.5 animate-spin" />
                          )}
                          Cancel
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreatePaymentScheduleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={reload}
      />

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel payment schedule?</DialogTitle>
            <DialogDescription>
              This will cancel the payment schedule for{" "}
              <span className="font-medium text-foreground">
                {cancelTarget?.memberName}
              </span>
              . Any pending installments will no longer be tracked. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border/40 bg-muted/30 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Remaining unpaid balance</span>
              <span className="font-mono font-medium">
                Rs {(cancelTarget?.remaining ?? 0).toLocaleString("en-IN")}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelTarget(null)}
              disabled={cancellingId !== null}
            >
              Keep schedule
            </Button>
            <Button
              variant="destructive"
              onClick={confirmCancel}
              disabled={cancellingId !== null}
            >
              {cancellingId !== null && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              Confirm Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
