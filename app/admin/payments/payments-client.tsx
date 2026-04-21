"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  getPayments,
  type PaymentListResult,
  type PaymentFilters,
} from "@/lib/actions/payments";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

function fmtCurrency(n: number): string {
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function modeBadgeVariant(
  mode: string
): "active" | "info" | "expiring" | "secondary" | "default" {
  const m = mode.toLowerCase();
  if (m === "complimentary") return "expiring";
  if (m === "cash") return "active";
  if (m === "upi") return "info";
  if (m === "cheque" || m === "bank_transfer") return "secondary";
  return "default";
}

export function PaymentsClient({
  initial,
  filters: initialFilters,
  modes,
  collectors,
  locations,
}: {
  initial: PaymentListResult;
  filters: PaymentFilters;
  modes: string[];
  collectors: { id: number; name: string }[];
  locations: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [data, setData] = useState<PaymentListResult>(initial);

  const [from, setFrom] = useState(initialFilters.from ?? "");
  const [to, setTo] = useState(initialFilters.to ?? "");
  const [mode, setMode] = useState(initialFilters.mode ?? "");
  const [locationId, setLocationId] = useState<string>(
    initialFilters.locationId ? String(initialFilters.locationId) : ""
  );
  const [collectedById, setCollectedById] = useState<string>(
    initialFilters.collectedById ? String(initialFilters.collectedById) : ""
  );
  const [q, setQ] = useState(initialFilters.q ?? "");

  const apply = (overrides?: Partial<PaymentFilters>) => {
    const next: PaymentFilters = {
      from,
      to,
      mode,
      locationId: locationId ? Number(locationId) : undefined,
      collectedById: collectedById ? Number(collectedById) : undefined,
      q,
      page: 1,
      ...overrides,
    };
    startTransition(async () => {
      const result = await getPayments(next);
      setData(result);
      // sync URL (shallow)
      const qs = new URLSearchParams();
      if (next.from) qs.set("from", next.from);
      if (next.to) qs.set("to", next.to);
      if (next.mode) qs.set("mode", next.mode);
      if (next.locationId) qs.set("locationId", String(next.locationId));
      if (next.collectedById) qs.set("collectedById", String(next.collectedById));
      if (next.q) qs.set("q", next.q);
      if (next.page && next.page > 1) qs.set("page", String(next.page));
      router.replace(`/admin/payments?${qs.toString()}`, { scroll: false });
    });
  };

  const goToPage = (page: number) => apply({ page });

  const exportCsv = () => {
    const headers = [
      "Date",
      "Member",
      "Phone",
      "Plan",
      "Amount",
      "Mode",
      "UPI Ref",
      "Note",
      "Collected By",
      "Invoice",
    ];
    const lines = data.rows.map((r) =>
      [
        new Date(r.date).toLocaleString("en-IN"),
        r.memberName,
        r.memberPhone ?? "",
        r.planName,
        String(r.amount),
        r.paymentMode,
        r.upiReference ?? "",
        (r.paymentNote ?? "").replace(/[\r\n,]/g, " "),
        r.collectedBy,
        r.invoiceNumber ?? "",
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [headers.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payments_${from || "all"}_${to || "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.max(1, Math.ceil(data.totalCount / data.pageSize));

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Payments</h1>
          <p className="text-sm text-muted-foreground">
            All payments across renewals, POS, freezes, refunds, and complimentary issues.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={data.rows.length === 0}>
          Export CSV (current page)
        </Button>
      </header>

      {/* Summary cards */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              Matching payments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {data.totalCount.toLocaleString("en-IN")}
            </p>
          </CardContent>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              Total amount
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{fmtCurrency(data.totalAmount)}</p>
          </CardContent>
        </Card>
        {data.byMode.slice(0, 2).map((m) => (
          <Card key={m.mode} size="sm">
            <CardHeader>
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
                {m.mode}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{fmtCurrency(m.amount)}</p>
              <p className="text-xs text-muted-foreground">
                {m.count.toLocaleString("en-IN")} txn
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="space-y-1">
              <Label htmlFor="from">From</Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="mode">Mode</Label>
              <Select
                value={mode === "" ? ALL : mode}
                onValueChange={(v) => setMode(v === ALL || v == null ? "" : v)}
              >
                <SelectTrigger id="mode">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All modes</SelectItem>
                  {modes.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {locations.length > 1 && (
              <div className="space-y-1">
                <Label htmlFor="loc">Location</Label>
                <Select
                  value={locationId === "" ? ALL : locationId}
                  onValueChange={(v) =>
                    setLocationId(v === ALL || v == null ? "" : v)
                  }
                >
                  <SelectTrigger id="loc">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All</SelectItem>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="collector">Collected by</Label>
              <Select
                value={collectedById === "" ? ALL : collectedById}
                onValueChange={(v) =>
                  setCollectedById(v === ALL || v == null ? "" : v)
                }
              >
                <SelectTrigger id="collector">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  {collectors.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="q">Search member</Label>
              <Input
                id="q"
                placeholder="name, phone, email"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") apply();
                }}
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={() => apply()} disabled={isPending}>
              {isPending ? "Loading…" : "Apply filters"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setFrom("");
                setTo("");
                setMode("");
                setLocationId("");
                setCollectedById("");
                setQ("");
                apply({
                  from: "",
                  to: "",
                  mode: "",
                  locationId: undefined,
                  collectedById: undefined,
                  q: "",
                });
              }}
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {data.rows.length === 0 ? (
        <Card size="sm">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No payments match these filters.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Collected by</TableHead>
                  <TableHead>Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {fmtDateTime(r.date)}
                    </TableCell>
                    <TableCell>
                      {r.memberId ? (
                        <Link
                          href={`/admin/members/${r.memberId}`}
                          className="hover:underline underline-offset-4"
                        >
                          {r.memberName}
                        </Link>
                      ) : (
                        <span>{r.memberName}</span>
                      )}
                      {r.memberPhone && (
                        <div className="text-xs text-muted-foreground">
                          {r.memberPhone}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{r.planName}</TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {fmtCurrency(r.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={modeBadgeVariant(r.paymentMode)}>
                        {r.paymentMode}
                      </Badge>
                      {r.upiReference && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {r.upiReference}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{r.collectedBy}</TableCell>
                    <TableCell className="text-sm">
                      {r.invoiceNumber ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {data.rows.map((r) => (
              <Card key={r.id} size="sm">
                <CardContent className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {r.memberId ? (
                        <Link
                          href={`/admin/members/${r.memberId}`}
                          className="font-medium hover:underline underline-offset-4 truncate block"
                        >
                          {r.memberName}
                        </Link>
                      ) : (
                        <span className="font-medium truncate block">
                          {r.memberName}
                        </span>
                      )}
                      {r.memberPhone && (
                        <div className="text-xs text-muted-foreground truncate">
                          {r.memberPhone}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{fmtCurrency(r.amount)}</div>
                      <Badge variant={modeBadgeVariant(r.paymentMode)}>
                        {r.paymentMode}
                      </Badge>
                    </div>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Plan</dt>
                    <dd className="text-right truncate">{r.planName}</dd>
                    <dt className="text-muted-foreground">When</dt>
                    <dd className="text-right">{fmtDateTime(r.date)}</dd>
                    <dt className="text-muted-foreground">By</dt>
                    <dd className="text-right">{r.collectedBy}</dd>
                    {r.invoiceNumber && (
                      <>
                        <dt className="text-muted-foreground">Invoice</dt>
                        <dd className="text-right">{r.invoiceNumber}</dd>
                      </>
                    )}
                  </dl>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm text-muted-foreground">
                Page {data.page} of {totalPages.toLocaleString("en-IN")} ·{" "}
                {data.totalCount.toLocaleString("en-IN")} total
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page <= 1 || isPending}
                  onClick={() => goToPage(data.page - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page >= totalPages || isPending}
                  onClick={() => goToPage(data.page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
