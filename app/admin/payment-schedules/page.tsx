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
import { CalendarClock, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  listSchedulesAction,
  cancelScheduleAction,
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

export default function PaymentSchedulesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("active");
  const [loading, startLoading] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const reload = () => {
    startLoading(async () => {
      const result = await listSchedulesAction({ status, page: 1, pageSize: 50 });
      setRows(result.data);
      setTotal(result.total);
    });
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleCancel = async (scheduleId: number) => {
    if (!confirm("Cancel this payment schedule?")) return;
    setCancellingId(scheduleId);
    const result = await cancelScheduleAction({
      scheduleId,
      reason: "manual cancellation",
    });
    setCancellingId(null);
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
          <Select value={status} onValueChange={(v) => setStatus(v ?? "active")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
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
                          onClick={() => handleCancel(row.id)}
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
    </div>
  );
}
