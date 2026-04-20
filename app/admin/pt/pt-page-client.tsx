"use client";

import { useEffect, useMemo, useState, useTransition, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SellPtPackageDialog } from "@/components/admin/sell-pt-package-dialog";
import { RecordPtSessionDialog } from "@/components/admin/record-pt-session-dialog";

type PtPackage = {
  id: number;
  userId: number;
  userName: string;
  userPhone: string | null;
  trainerId: number;
  trainerName: string;
  sessionsTotal: number;
  sessionsUsed: number;
  pricePerSession: number;
  totalPrice: number;
  trainerSharePct: number;
  startedAt: string;
  expiresAt: string | null;
  status: string;
  paymentId: number | null;
  paymentStatus: string | null;
  paymentMode: string | null;
};

type Trainer = {
  id: number;
  firstname: string;
  lastname: string;
  role: string;
  isExternal: boolean;
  defaultGymCutPct: number;
  ownTrainerCutPct: number;
};

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "expired", label: "Expired" },
  { key: "all", label: "All" },
];

function statusBadgeClass(status: string) {
  switch (status) {
    case "active":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    case "completed":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
    case "expired":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "cancelled":
      return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
    default:
      return "";
  }
}

export function PtPageClient({
  initialPackages,
  trainers,
}: {
  initialPackages: PtPackage[];
  trainers: Trainer[];
}) {
  const [packages, setPackages] = useState<PtPackage[]>(initialPackages);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [trainerFilter, setTrainerFilter] = useState<number | undefined>(undefined);
  const [, startTransition] = useTransition();
  const [sellOpen, setSellOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordPackageId, setRecordPackageId] = useState<number | null>(null);

  const reload = useCallback(() => {
    startTransition(async () => {
      const { listPtPackagesAction } = await import("@/lib/actions/pt");
      const data = await listPtPackagesAction({
        status: statusFilter,
        trainerId: trainerFilter,
      });
      setPackages(data as PtPackage[]);
    });
  }, [statusFilter, trainerFilter]);

  useEffect(() => {
    reload();
  }, [reload]);

  const visible = useMemo(() => packages, [packages]);

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="shrink-0 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold">PT Packages</h1>
          <Button onClick={() => setSellOpen(true)}>Sell New Package</Button>
        </div>

        {/* Filter pills */}
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setStatusFilter(f.key)}
              className={
                "rounded-full border px-3 py-1 text-xs transition-colors " +
                (statusFilter === f.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background hover:bg-muted")
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Label className="text-sm">Trainer:</Label>
            <select
              value={trainerFilter ?? ""}
              onChange={(e) =>
                setTrainerFilter(e.target.value ? Number(e.target.value) : undefined)
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All trainers</option>
              {trainers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.firstname} {t.lastname}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Mobile card view (<sm) */}
        <div className="sm:hidden space-y-2">
          {visible.length === 0 ? (
            <Card size="sm">
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                No PT packages found
              </CardContent>
            </Card>
          ) : (
            visible.map((p) => (
              <Card key={p.id} size="sm">
                <CardContent className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{p.userName}</div>
                      {p.userPhone && (
                        <div className="text-xs text-muted-foreground truncate">
                          {p.userPhone}
                        </div>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={statusBadgeClass(p.status)}
                    >
                      {p.status}
                    </Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    <dt className="text-muted-foreground">Trainer</dt>
                    <dd className="text-right">
                      <Link
                        href={`/admin/trainers/${p.trainerId}`}
                        className="hover:underline"
                      >
                        {p.trainerName}
                      </Link>
                    </dd>
                    <dt className="text-muted-foreground">Sessions</dt>
                    <dd className="text-right">
                      {p.sessionsUsed} / {p.sessionsTotal}
                      <span className="text-muted-foreground">
                        {" "}
                        ({p.sessionsTotal - p.sessionsUsed} left)
                      </span>
                    </dd>
                    <dt className="text-muted-foreground">Price</dt>
                    <dd className="text-right">
                      ₹{p.totalPrice.toLocaleString("en-IN")}
                      <span className="text-muted-foreground">
                        {" "}
                        (₹{p.pricePerSession.toLocaleString("en-IN")}/sess)
                      </span>
                    </dd>
                    <dt className="text-muted-foreground">Started</dt>
                    <dd className="text-right">{p.startedAt.split("T")[0]}</dd>
                    <dt className="text-muted-foreground">Expires</dt>
                    <dd className="text-right">
                      {p.expiresAt ? p.expiresAt.split("T")[0] : "—"}
                    </dd>
                  </dl>
                  {p.status === "active" && (
                    <Button
                      variant="outline"
                      className="w-full min-h-11"
                      onClick={() => {
                        setRecordPackageId(p.id);
                        setRecordOpen(true);
                      }}
                    >
                      Record Session
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Desktop table view (sm+) */}
        <div className="hidden sm:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Trainer</TableHead>
                <TableHead>Sessions</TableHead>
                <TableHead className="hidden md:table-cell">Price</TableHead>
                <TableHead className="hidden lg:table-cell">Started</TableHead>
                <TableHead className="hidden lg:table-cell">Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <div className="font-medium">{p.userName}</div>
                    {p.userPhone && (
                      <div className="text-xs text-muted-foreground">{p.userPhone}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/trainers/${p.trainerId}`}
                      className="hover:underline"
                    >
                      {p.trainerName}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {p.sessionsUsed} / {p.sessionsTotal}
                    <div className="text-xs text-muted-foreground">
                      {p.sessionsTotal - p.sessionsUsed} left
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell whitespace-nowrap">
                    ₹{p.totalPrice.toLocaleString("en-IN")}
                    <div className="text-xs text-muted-foreground">
                      ₹{p.pricePerSession.toLocaleString("en-IN")}/sess
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell whitespace-nowrap">
                    {p.startedAt.split("T")[0]}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell whitespace-nowrap">
                    {p.expiresAt ? p.expiresAt.split("T")[0] : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusBadgeClass(p.status)}>
                      {p.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {p.status === "active" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setRecordPackageId(p.id);
                            setRecordOpen(true);
                          }}
                        >
                          Record Session
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    No PT packages found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <SellPtPackageDialog
        open={sellOpen}
        onOpenChange={setSellOpen}
        trainers={trainers}
        onSold={reload}
      />
      <RecordPtSessionDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        packageId={recordPackageId}
        defaultStatus="completed"
        onRecorded={reload}
      />
    </div>
  );
}
