"use client";

import { useEffect, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { getScheduleForTicketAction } from "@/lib/actions/payment-schedule";
import {
  RecordInstallmentPaymentDialog,
  type InstallmentDialogContext,
} from "./record-installment-payment-dialog";

type Schedule = NonNullable<Awaited<ReturnType<typeof getScheduleForTicketAction>>>;

export function PaymentScheduleSummary({
  memberTicketId,
  memberName,
}: {
  memberTicketId: number;
  memberName: string;
}) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loading, startLoading] = useTransition();
  const [payContext, setPayContext] = useState<InstallmentDialogContext | null>(null);

  const reload = () => {
    startLoading(async () => {
      const result = await getScheduleForTicketAction(memberTicketId);
      setSchedule(result);
    });
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberTicketId]);

  if (loading && !schedule) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Payment schedule</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (!schedule) {
    return null;
  }

  const paidCount = schedule.installments.filter((i) => i.status === "paid").length;
  const overdueCount = schedule.installments.filter((i) => i.isOverdue).length;

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarDays className="size-4 text-primary" />
            Payment schedule
            <Badge
              variant={
                schedule.status === "completed"
                  ? "secondary"
                  : schedule.status === "defaulted"
                    ? "destructive"
                    : "outline"
              }
            >
              {schedule.status}
            </Badge>
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {paidCount}/{schedule.installments.length} paid
          </span>
        </CardHeader>
        <CardContent>
          {overdueCount > 0 && (
            <div className="mb-2 flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="size-3.5" />
              {overdueCount} overdue installment{overdueCount === 1 ? "" : "s"}
            </div>
          )}
          <ol className="space-y-1.5">
            {schedule.installments.map((inst) => {
              const remaining = inst.amount - inst.paidAmount;
              const isPaid = inst.status === "paid";
              const isWaived = inst.status === "waived";
              return (
                <li
                  key={inst.id}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                    isPaid
                      ? "border-green-500/30 bg-green-500/5"
                      : inst.isOverdue
                        ? "border-destructive/30 bg-destructive/5"
                        : "border-border/40 bg-muted/20"
                  }`}
                >
                  <span className="w-5 text-center text-muted-foreground">
                    #{inst.sequenceNumber}
                  </span>
                  {isPaid ? (
                    <CheckCircle2 className="size-3.5 text-green-600 dark:text-green-400" />
                  ) : (
                    <Clock className="size-3.5 text-muted-foreground" />
                  )}
                  <div className="flex-1">
                    <div>
                      Rs {inst.amount.toLocaleString("en-IN")}{" "}
                      <span className="text-muted-foreground">
                        · {new Date(inst.dueDate).toLocaleDateString("en-IN")}
                      </span>
                    </div>
                    {inst.paidAmount > 0 && !isPaid && (
                      <div className="text-muted-foreground">
                        Partial: Rs {inst.paidAmount.toLocaleString("en-IN")}
                      </div>
                    )}
                  </div>
                  {!isPaid && !isWaived && schedule.status === "active" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPayContext({
                          installmentId: inst.id,
                          memberName,
                          sequenceNumber: inst.sequenceNumber,
                          expectedAmount: inst.amount,
                          remaining,
                        })
                      }
                    >
                      Pay
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
      <RecordInstallmentPaymentDialog
        context={payContext}
        onOpenChange={(open) => {
          if (!open) setPayContext(null);
        }}
        onRecorded={reload}
      />
    </>
  );
}
