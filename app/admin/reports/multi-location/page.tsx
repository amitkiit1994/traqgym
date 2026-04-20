"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { getMultiLocationRollupAction } from "@/lib/actions/multi-location-rollup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Row = Awaited<ReturnType<typeof getMultiLocationRollupAction>>[number];

function startOfMonthStr() {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().split("T")[0];
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function fmtINR(n: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function MultiLocationReportPage() {
  const [fromDate, setFromDate] = useState(startOfMonthStr());
  const [toDate, setToDate] = useState(todayStr());
  const [rows, setRows] = useState<Row[]>([]);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getMultiLocationRollupAction({ fromDate, toDate });
      setRows(data);
    });
  };

  useEffect(() => {
    load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const { maxAbsNet, totals } = useMemo(() => {
    let maxAbs = 0;
    let collections = 0;
    let expenses = 0;
    let net = 0;
    let activeMembers = 0;
    for (const r of rows) {
      maxAbs = Math.max(maxAbs, Math.abs(r.netThisPeriod));
      collections += r.collectionsThisPeriod;
      expenses += r.expensesThisPeriod;
      net += r.netThisPeriod;
      activeMembers += r.activeMembers;
    }
    return {
      maxAbsNet: maxAbs,
      totals: { collections, expenses, net, activeMembers },
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/reports"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Reports
        </Link>
        <h1 className="text-xl font-semibold">Multi-Location Rollup</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Date Range</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>From</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full sm:w-40"
              />
            </div>
            <div>
              <Label>To</Label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full sm:w-40"
              />
            </div>
            <Button onClick={load} disabled={isPending}>
              {isPending ? "Loading..." : "Load"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By Location</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Active Members</TableHead>
                <TableHead className="text-right">Collections</TableHead>
                <TableHead className="text-right hidden md:table-cell">
                  Expenses
                </TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="hidden lg:table-cell">Net Heat</TableHead>
                <TableHead className="text-right hidden md:table-cell">
                  Avg Ticket
                </TableHead>
                <TableHead className="text-right hidden md:table-cell">
                  Churn %
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const widthPct =
                  maxAbsNet > 0
                    ? Math.round(
                        (Math.abs(r.netThisPeriod) / maxAbsNet) * 100
                      )
                    : 0;
                const positive = r.netThisPeriod >= 0;
                return (
                  <TableRow key={r.locationId}>
                    <TableCell className="font-medium">
                      {r.locationName}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.activeMembers}
                    </TableCell>
                    <TableCell className="text-right">
                      {fmtINR(r.collectionsThisPeriod)}
                    </TableCell>
                    <TableCell className="text-right hidden md:table-cell">
                      {fmtINR(r.expensesThisPeriod)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold ${
                        positive ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {fmtINR(r.netThisPeriod)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="h-2 w-full max-w-32 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full ${
                            positive ? "bg-green-500" : "bg-red-500"
                          }`}
                          style={{ width: `${widthPct}%` }}
                          aria-label={`Net heat ${widthPct}%`}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right hidden md:table-cell">
                      {fmtINR(r.avgTicketSize)}
                    </TableCell>
                    <TableCell className="text-right hidden md:table-cell">
                      {r.churnRatePct}%
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && !isPending && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-muted-foreground"
                  >
                    No locations found
                  </TableCell>
                </TableRow>
              )}
              {rows.length > 0 && (
                <TableRow className="font-semibold border-t-2">
                  <TableCell>Totals</TableCell>
                  <TableCell className="text-right">
                    {totals.activeMembers}
                  </TableCell>
                  <TableCell className="text-right">
                    {fmtINR(totals.collections)}
                  </TableCell>
                  <TableCell className="text-right hidden md:table-cell">
                    {fmtINR(totals.expenses)}
                  </TableCell>
                  <TableCell
                    className={`text-right ${
                      totals.net >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {fmtINR(totals.net)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell" />
                  <TableCell className="hidden md:table-cell" />
                  <TableCell className="hidden md:table-cell" />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
