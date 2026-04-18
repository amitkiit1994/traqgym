"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  processRefundAction,
  rejectRefundAction,
} from "@/lib/actions/refund";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type SerializedRefund = {
  id: number;
  paymentId: number;
  invoiceId: number | null;
  memberTicketId: number | null;
  userId: number | null;
  userName: string | null;
  amountRequested: number;
  amountRefunded: number;
  refundMode: string;
  reason: string;
  reasonDetail: string | null;
  status: string;
  requestedById: number;
  requestedByName: string;
  approvedById: number | null;
  approvedByName: string | null;
  approvedAt: string | null;
  processedAt: string | null;
  pgRefundId: string | null;
  gstReversalAmount: number | null;
  proRataDays: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "processed", label: "Processed" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

function formatDateTime(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function inr(n: number | null | undefined) {
  if (n == null) return "-";
  return `₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}${n < 0 ? " (cr)" : ""}`;
}

function statusVariant(status: string) {
  if (status === "processed") return "active" as const;
  if (status === "approved") return "expiring" as const;
  if (status === "rejected" || status === "failed") return "destructive" as const;
  return "expiring" as const; // pending
}

export function RefundsClient({
  initialRows,
  activeStatus,
  isAdmin,
}: {
  initialRows: SerializedRefund[];
  activeStatus: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<
    "process" | "reject" | null
  >(null);
  const [note, setNote] = useState("");
  const [pgRefundId, setPgRefundId] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const updateFilter = (status: string) => {
    const params = new URLSearchParams();
    if (status !== "pending") params.set("status", status);
    const qs = params.toString();
    router.push(qs ? `/admin/refunds?${qs}` : "/admin/refunds");
  };

  const open = (id: number, action: "process" | "reject") => {
    setEditingId(id);
    setPendingAction(action);
    setNote("");
    setPgRefundId("");
    setFeedback(null);
  };

  const close = () => {
    setEditingId(null);
    setPendingAction(null);
    setNote("");
    setPgRefundId("");
  };

  const submit = () => {
    if (editingId == null || !pendingAction) return;
    const id = editingId;
    const action = pendingAction;
    startTransition(async () => {
      if (action === "process") {
        const res = await processRefundAction({
          refundId: id,
          pgRefundId: pgRefundId || undefined,
        });
        if (res.success) {
          setFeedback(
            res.data?.alreadyProcessed
              ? `Refund #${id} was already processed`
              : `Refund #${id} processed${res.data?.gstReversalAmount != null ? ` (GST reversal ${inr(res.data.gstReversalAmount)})` : ""}`
          );
          close();
          router.refresh();
        } else {
          setFeedback(res.error);
        }
      } else {
        const res = await rejectRefundAction({
          refundId: id,
          decisionNote: note || undefined,
        });
        if (res.success) {
          setFeedback(
            res.data?.alreadyDecided
              ? `Refund #${id} was already decided`
              : `Refund #${id} rejected`
          );
          close();
          router.refresh();
        } else {
          setFeedback(res.error);
        }
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Refunds</h1>
        <p className="text-sm text-muted-foreground">
          {initialRows.length} {activeStatus === "all" ? "" : activeStatus} refund
          {initialRows.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="flex gap-1 border-b">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.value}
            onClick={() => updateFilter(s.value)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize ${
              activeStatus === s.value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {feedback && <p className="text-sm text-muted-foreground">{feedback}</p>}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">ID</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead className="hidden md:table-cell">Mode</TableHead>
              <TableHead className="hidden md:table-cell">Reason</TableHead>
              <TableHead className="hidden lg:table-cell">Requested by</TableHead>
              <TableHead className="hidden lg:table-cell">Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialRows.map((r) => {
              const editing = editingId === r.id;
              const canProcess = isAdmin && r.status === "approved";
              const canReject =
                isAdmin && (r.status === "pending" || r.status === "approved");
              return (
                <Fragment key={r.id}>
                  <TableRow>
                    <TableCell className="font-mono text-xs">
                      #{r.id}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.userName ?? "-"}
                      <p className="text-[10px] text-muted-foreground">
                        Payment #{r.paymentId}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="font-semibold">
                        {inr(r.amountRequested)}
                      </span>
                      {r.amountRefunded > 0 && (
                        <p className="text-[10px] text-muted-foreground">
                          Refunded: {inr(r.amountRefunded)}
                        </p>
                      )}
                      {r.gstReversalAmount != null && (
                        <p className="text-[10px] text-muted-foreground">
                          GST rev: {inr(r.gstReversalAmount)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs capitalize">
                      {r.refundMode.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs capitalize">
                      {r.reason.replace(/_/g, " ")}
                      {r.reasonDetail && (
                        <p className="text-[10px] text-muted-foreground">
                          {r.reasonDetail}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs">
                      {r.requestedByName}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                      {formatDateTime(r.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={statusVariant(r.status)}
                        className="capitalize"
                      >
                        {r.status}
                      </Badge>
                      {r.processedAt && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {formatDateTime(r.processedAt)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {(canProcess || canReject) ? (
                        <div className="inline-flex gap-1">
                          {canProcess && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isPending}
                              onClick={() => open(r.id, "process")}
                            >
                              Process
                            </Button>
                          )}
                          {canReject && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isPending}
                              onClick={() => open(r.id, "reject")}
                            >
                              Reject
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {r.approvedByName ?? "-"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                  {editing && (
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={9}>
                        <div className="flex flex-col gap-2 p-2 sm:flex-row sm:items-end">
                          {pendingAction === "process" ? (
                            <div className="flex-1">
                              <Label htmlFor={`pg-${r.id}`}>
                                Payment-gateway refund ID (optional)
                              </Label>
                              <Input
                                id={`pg-${r.id}`}
                                value={pgRefundId}
                                onChange={(e) => setPgRefundId(e.target.value)}
                                placeholder="rzp_rfnd_..."
                              />
                            </div>
                          ) : (
                            <Textarea
                              placeholder="Optional rejection note"
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                              className="min-h-[60px] flex-1"
                            />
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={submit}
                              disabled={isPending}
                            >
                              {isPending
                                ? "Saving..."
                                : pendingAction === "process"
                                  ? "Confirm process"
                                  : "Confirm reject"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={close}
                              disabled={isPending}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
            {initialRows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="text-center text-muted-foreground py-8"
                >
                  No refunds in this filter
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
