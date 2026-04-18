"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { OpenShiftDialog, type LocationOption } from "@/components/admin/open-shift-dialog";
import { CloseShiftDialog } from "@/components/admin/close-shift-dialog";
import { RecordMovementDialog } from "@/components/admin/record-movement-dialog";

export type SerializedShift = {
  id: number;
  locationId: number;
  locationName: string;
  openedById: number;
  openedByName: string;
  openedAt: string;
  openingFloat: number;
  closedById: number | null;
  closedByName: string | null;
  closedAt: string | null;
  closingExpected: number | null;
  closingCounted: number | null;
  variance: number | null;
  varianceReason: string | null;
  status: string;
  approvedById: number | null;
  approvedByName: string | null;
  approvedAt: string | null;
  notes: string | null;
};

const TABS: Array<{ value: string; label: string }> = [
  { value: "open", label: "Open" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "closed", label: "Closed" },
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
  const sign = n < 0 ? "-" : "";
  return `${sign}₹${Math.round(Math.abs(n)).toLocaleString("en-IN")}`;
}

function statusBadge(status: string) {
  if (status === "closed") return "active" as const;
  if (status === "pending_approval") return "expiring" as const;
  if (status === "voided") return "destructive" as const;
  return "expiring" as const; // open
}

export function ShiftsClient({
  activeTab,
  openShifts,
  pendingShifts,
  closedShifts,
  locations,
  isAdmin,
}: {
  activeTab: string;
  openShifts: SerializedShift[];
  pendingShifts: SerializedShift[];
  closedShifts: SerializedShift[];
  locations: LocationOption[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [openDialog, setOpenDialog] = useState<
    | null
    | { kind: "open" }
    | { kind: "close"; shift: SerializedShift }
    | { kind: "movement"; shiftId: number }
  >(null);

  const switchTab = (t: string) => {
    const params = new URLSearchParams();
    if (t !== "open") params.set("tab", t);
    const qs = params.toString();
    router.push(qs ? `/admin/shifts?${qs}` : "/admin/shifts");
  };

  const rows =
    activeTab === "closed"
      ? closedShifts
      : activeTab === "pending_approval"
        ? pendingShifts
        : openShifts;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Cash Shifts</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => setOpenDialog({ kind: "open" })}>
            Open shift
          </Button>
        </div>
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map((t) => {
          const count =
            t.value === "open"
              ? openShifts.length
              : t.value === "pending_approval"
                ? pendingShifts.length
                : closedShifts.length;
          const variant: React.ComponentProps<typeof Badge>["variant"] =
            t.value === "pending_approval" && count > 0
              ? "destructive"
              : t.value === "closed"
                ? "secondary"
                : "default";
          return (
            <button
              key={t.value}
              onClick={() => switchTab(t.value)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-2 ${
                activeTab === t.value
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              <Badge variant={variant} className="text-[10px]">
                {count}
              </Badge>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">ID</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Opened</TableHead>
              <TableHead className="hidden md:table-cell">Float</TableHead>
              {activeTab !== "open" && (
                <>
                  <TableHead className="hidden md:table-cell">Expected</TableHead>
                  <TableHead className="hidden md:table-cell">Counted</TableHead>
                  <TableHead>Variance</TableHead>
                </>
              )}
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => {
              const colSpan = activeTab !== "open" ? 9 : 6;
              const variance = s.variance;
              const varianceClass =
                variance == null
                  ? ""
                  : Math.abs(variance) < 1
                    ? "text-muted-foreground"
                    : variance < 0
                      ? "text-destructive font-semibold"
                      : "text-amber-500 font-semibold";
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">#{s.id}</TableCell>
                  <TableCell className="text-xs">
                    {s.locationName}
                    <p className="text-[10px] text-muted-foreground">
                      Opened by {s.openedByName}
                    </p>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(s.openedAt)}
                    {s.closedAt && (
                      <p className="text-[10px]">
                        Closed: {formatDateTime(s.closedAt)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs">
                    {inr(s.openingFloat)}
                  </TableCell>
                  {activeTab !== "open" && (
                    <>
                      <TableCell className="hidden md:table-cell text-xs">
                        {inr(s.closingExpected)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs">
                        {inr(s.closingCounted)}
                      </TableCell>
                      <TableCell className={`text-xs ${varianceClass}`}>
                        {inr(variance)}
                        {s.varianceReason && (
                          <p className="text-[10px] text-muted-foreground">
                            {s.varianceReason}
                          </p>
                        )}
                      </TableCell>
                    </>
                  )}
                  <TableCell>
                    <Badge variant={statusBadge(s.status)} className="capitalize">
                      {s.status.replace(/_/g, " ")}
                    </Badge>
                    {s.approvedByName && (
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        by {s.approvedByName}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {s.status === "open" && (
                      <div className="inline-flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setOpenDialog({ kind: "movement", shiftId: s.id })
                          }
                        >
                          Movement
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setOpenDialog({ kind: "close", shift: s })
                          }
                        >
                          Close
                        </Button>
                      </div>
                    )}
                    {s.status === "pending_approval" && (
                      <span className="text-[11px] text-muted-foreground">
                        {isAdmin ? (
                          <a
                            href="/admin/approvals?type=cash_shift_variance"
                            className="underline"
                          >
                            Decide in Approvals
                          </a>
                        ) : (
                          "Awaiting admin"
                        )}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={activeTab !== "open" ? 9 : 6}
                  className="text-center text-muted-foreground py-8"
                >
                  No {activeTab.replace(/_/g, " ")} shifts
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {openDialog?.kind === "open" && (
        <OpenShiftDialog
          open={true}
          onOpenChange={(v) => !v && setOpenDialog(null)}
          locations={locations}
        />
      )}
      {openDialog?.kind === "close" && (
        <CloseShiftDialog
          open={true}
          onOpenChange={(v) => !v && setOpenDialog(null)}
          shiftId={openDialog.shift.id}
          locationName={openDialog.shift.locationName}
          openingFloat={openDialog.shift.openingFloat}
        />
      )}
      {openDialog?.kind === "movement" && (
        <RecordMovementDialog
          open={true}
          onOpenChange={(v) => !v && setOpenDialog(null)}
          shiftId={openDialog.shiftId}
        />
      )}
    </div>
  );
}
