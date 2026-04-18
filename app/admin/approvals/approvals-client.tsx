"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveRequestAction,
  rejectRequestAction,
} from "@/lib/actions/approvals";
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

export type SerializedApproval = {
  id: number;
  type: string;
  entityType: string;
  entityId: number | null;
  payloadJson: unknown;
  status: string;
  requestedById: number;
  requestedByName: string;
  decidedById: number | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expiresAt: string | null;
  createdAt: string;
};

const TYPE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "comp", label: "Comp" },
  { value: "comp_pass", label: "Comp Pass" },
  { value: "freeze", label: "Freeze" },
  { value: "extension", label: "Extension" },
  { value: "refund", label: "Refund" },
  { value: "discount_over_threshold", label: "Discount" },
];

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
  { value: "cancelled", label: "Cancelled" },
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

function statusVariant(status: string) {
  if (status === "approved") return "active" as const;
  if (status === "rejected") return "destructive" as const;
  if (status === "expired") return "expired" as const;
  if (status === "cancelled") return "secondary" as const;
  return "expiring" as const; // pending
}

function payloadPreview(payload: unknown): string {
  try {
    const json = JSON.stringify(payload);
    if (json.length <= 150) return json;
    return json.slice(0, 147) + "...";
  } catch {
    return "-";
  }
}

export function ApprovalsClient({
  initialRows,
  pendingCount,
  activeType,
  activeStatus,
  isAdmin,
}: {
  initialRows: SerializedApproval[];
  pendingCount: number;
  activeType: string;
  activeStatus: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<"approve" | "reject" | null>(
    null
  );
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const rows = initialRows;

  const updateFilter = (key: "type" | "status", value: string) => {
    const params = new URLSearchParams();
    const nextType = key === "type" ? value : activeType;
    const nextStatus = key === "status" ? value : activeStatus;
    if (nextType !== "all") params.set("type", nextType);
    if (nextStatus !== "pending") params.set("status", nextStatus);
    const qs = params.toString();
    router.push(qs ? `/admin/approvals?${qs}` : "/admin/approvals");
  };

  const openDecision = (id: number, action: "approve" | "reject") => {
    setEditingId(id);
    setPendingAction(action);
    setNote("");
    setFeedback(null);
  };

  const closeDecision = () => {
    setEditingId(null);
    setPendingAction(null);
    setNote("");
  };

  const submitDecision = () => {
    if (editingId == null || !pendingAction) return;
    const id = editingId;
    const action = pendingAction;
    startTransition(async () => {
      const fn =
        action === "approve" ? approveRequestAction : rejectRequestAction;
      const res = await fn({ approvalId: id, note: note || undefined });
      if (res.success) {
        const already = res.data?.alreadyDecided;
        setFeedback(
          already
            ? `Approval #${id} was already decided`
            : `Approval #${id} ${action === "approve" ? "approved" : "rejected"}`
        );
        closeDecision();
        router.refresh();
      } else {
        setFeedback(res.error);
      }
    });
  };

  const visibleRowCount = useMemo(() => rows.length, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Pending Approvals</h1>
          {pendingCount > 0 && (
            <Badge variant="destructive">{pendingCount}</Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Showing {visibleRowCount} {activeStatus} request
          {visibleRowCount === 1 ? "" : "s"}
        </p>
      </div>

      {/* Type filter pills */}
      <div className="flex flex-wrap gap-1">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => updateFilter("type", f.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              activeType === f.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 border-b">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.value}
            onClick={() => updateFilter("status", s.value)}
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

      {feedback && (
        <p className="text-sm text-muted-foreground">{feedback}</p>
      )}

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Requested by</TableHead>
              <TableHead className="hidden md:table-cell">Requested</TableHead>
              <TableHead>Payload</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const editing = editingId === r.id;
              return (
                <Fragment key={r.id}>
                  <TableRow>
                    <TableCell className="font-mono text-xs">
                      #{r.id}
                    </TableCell>
                    <TableCell className="capitalize">
                      {r.type.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.entityType}
                      {r.entityId != null ? ` #${r.entityId}` : ""}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.requestedByName}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                      {formatDateTime(r.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <code className="text-[11px] text-muted-foreground break-all">
                        {payloadPreview(r.payloadJson)}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={statusVariant(r.status)}
                        className="capitalize"
                      >
                        {r.status}
                      </Badge>
                      {r.decisionNote && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {r.decisionNote}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status === "pending" && isAdmin ? (
                        <div className="inline-flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() => openDecision(r.id, "approve")}
                          >
                            Approve
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() => openDecision(r.id, "reject")}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {r.decidedByName ?? "-"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                  {editing && (
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={8}>
                        <div className="flex flex-col gap-2 p-2 sm:flex-row sm:items-center">
                          <Textarea
                            placeholder={`Optional note for ${pendingAction === "approve" ? "approval" : "rejection"}`}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            className="min-h-[60px] flex-1"
                          />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={submitDecision}
                              disabled={isPending}
                            >
                              {isPending
                                ? "Saving..."
                                : pendingAction === "approve"
                                  ? "Confirm Approve"
                                  : "Confirm Reject"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={closeDecision}
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
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  No {activeStatus} approvals
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
