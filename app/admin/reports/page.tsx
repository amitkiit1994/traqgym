"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { getCollectionReport, getMemberReport, getAttendanceReport, getLoginHistory, getProfitLossReport, getMembershipMatrix, getSourceAnalysis } from "@/lib/actions/reports";
import { getLocations } from "@/lib/actions/locations";
import { getMonthlyRevenueTrendAction } from "@/lib/actions/revenue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type LocationOption = { id: number; name: string; isActive: boolean };

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function fmt(date: string) {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(date: string) {
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --- Collection Report ---

type CollectionRow = Awaited<ReturnType<typeof getCollectionReport>>[number];

function CollectionReport({ locations }: { locations: LocationOption[] }) {
  const [date, setDate] = useState(todayStr());
  const [locationId, setLocationId] = useState(() => locations.length === 1 ? String(locations[0].id) : "");
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getCollectionReport(
        date,
        locationId ? parseInt(locationId, 10) : undefined
      );
      setRows(data);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const totalCash = rows.filter((r) => r.paymentMode === "cash").reduce((s, r) => s + r.amount, 0);
  const totalUpi = rows.filter((r) => r.paymentMode === "upi").reduce((s, r) => s + r.amount, 0);
  const grandTotal = rows.reduce((s, r) => s + r.amount, 0);

  const exportCsv = () => {
    downloadCsv(
      `collection-report-${date}.csv`,
      ["Member", "Plan", "Amount", "Mode", "UPI Ref", "Collected By", "Time"],
      rows.map((r) => [r.memberName, r.planName, String(r.amount), r.paymentMode, r.upiReference ?? "", r.collectedBy, new Date(r.time).toLocaleTimeString("en-IN")])
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Date</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full sm:w-40" />
        </div>
        {locations.length > 1 ? (
          <div>
            <Label>Location</Label>
            <Select value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All locations">{locationId ? locations.find((l) => String(l.id) === locationId)?.name ?? "All Locations" : "All Locations"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Locations</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : locations.length === 1 ? (
          <div>
            <Label>Location</Label>
            <span className="flex h-9 items-center text-sm text-muted-foreground">{locations[0].name}</span>
          </div>
        ) : null}
        <Button onClick={load} disabled={isPending}>Load</Button>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead className="hidden md:table-cell">UPI Ref</TableHead>
            <TableHead className="hidden md:table-cell">Collected By</TableHead>
            <TableHead className="hidden md:table-cell">Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.memberName}</TableCell>
              <TableCell>{r.planName}</TableCell>
              <TableCell className="text-right">{r.amount.toFixed(2)}</TableCell>
              <TableCell>{r.paymentMode}</TableCell>
              <TableCell className="hidden md:table-cell">{r.upiReference ?? "-"}</TableCell>
              <TableCell className="hidden md:table-cell">{r.collectedBy}</TableCell>
              <TableCell className="hidden md:table-cell">{fmtTime(r.time)}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">No collections found</TableCell>
            </TableRow>
          )}
          {rows.length > 0 && (
            <TableRow className="font-medium border-t-2">
              <TableCell colSpan={2}>Totals</TableCell>
              <TableCell className="text-right">{grandTotal.toFixed(2)}</TableCell>
              <TableCell colSpan={4}>
                Cash: {totalCash.toFixed(2)} | UPI: {totalUpi.toFixed(2)}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// --- Member Report ---

type MemberRow = Awaited<ReturnType<typeof getMemberReport>>[number];

const statusVariant: Record<string, "default" | "destructive" | "secondary"> = {
  active: "default",
  expired: "destructive",
  no_plan: "secondary",
};

function MemberReport({ locations }: { locations: LocationOption[] }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [locationId, setLocationId] = useState(() => locations.length === 1 ? String(locations[0].id) : "");
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getMemberReport(
        statusFilter,
        locationId ? parseInt(locationId, 10) : undefined
      );
      setRows(data);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const exportCsv = () => {
    downloadCsv(
      `member-report.csv`,
      ["Name", "Email", "Phone", "Location", "Plan", "Status", "Expiry Date"],
      rows.map((r) => [r.name, r.email, r.phone, r.location, r.plan, r.status, r.expiry === "-" ? "-" : fmt(r.expiry)])
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Status</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="no_plan">No Plan</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {locations.length > 1 ? (
          <div>
            <Label>Location</Label>
            <Select value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All locations">{locationId ? locations.find((l) => String(l.id) === locationId)?.name ?? "All Locations" : "All Locations"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Locations</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : locations.length === 1 ? (
          <div>
            <Label>Location</Label>
            <span className="flex h-9 items-center text-sm text-muted-foreground">{locations[0].name}</span>
          </div>
        ) : null}
        <Button onClick={load} disabled={isPending}>Load</Button>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Email</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead className="hidden md:table-cell">Location</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Expiry</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.name}</TableCell>
              <TableCell className="hidden md:table-cell">{r.email}</TableCell>
              <TableCell>{r.phone}</TableCell>
              <TableCell className="hidden md:table-cell">{r.location}</TableCell>
              <TableCell>{r.plan}</TableCell>
              <TableCell>
                <Badge variant={statusVariant[r.status]}>{r.status}</Badge>
              </TableCell>
              <TableCell className="hidden md:table-cell">{r.expiry === "-" ? "-" : fmt(r.expiry)}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">No members found</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// --- Attendance Report ---

type AttendanceRow = Awaited<ReturnType<typeof getAttendanceReport>>[number];

function AttendanceReport({ locations }: { locations: LocationOption[] }) {
  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(todayStr());
  const [locationId, setLocationId] = useState(() => locations.length === 1 ? String(locations[0].id) : "");
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getAttendanceReport(
        fromDate,
        toDate,
        locationId ? parseInt(locationId, 10) : undefined
      );
      setRows(data);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const exportCsv = () => {
    downloadCsv(
      `attendance-report-${fromDate}-to-${toDate}.csv`,
      ["Date", "Member", "Check In", "Check Out", "Source", "Location"],
      rows.map((r) => [
        fmt(r.date),
        r.memberName,
        fmtTime(r.checkIn),
        r.checkOut ? fmtTime(r.checkOut) : "-",
        r.source,
        r.location,
      ])
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full sm:w-40" />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full sm:w-40" />
        </div>
        {locations.length > 1 ? (
          <div>
            <Label>Location</Label>
            <Select value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All locations">{locationId ? locations.find((l) => String(l.id) === locationId)?.name ?? "All Locations" : "All Locations"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Locations</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : locations.length === 1 ? (
          <div>
            <Label>Location</Label>
            <span className="flex h-9 items-center text-sm text-muted-foreground">{locations[0].name}</span>
          </div>
        ) : null}
        <Button onClick={load} disabled={isPending}>Load</Button>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Member</TableHead>
            <TableHead>Check In</TableHead>
            <TableHead className="hidden md:table-cell">Check Out</TableHead>
            <TableHead className="hidden md:table-cell">Source</TableHead>
            <TableHead className="hidden md:table-cell">Location</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{fmt(r.date)}</TableCell>
              <TableCell>{r.memberName}</TableCell>
              <TableCell>{fmtTime(r.checkIn)}</TableCell>
              <TableCell className="hidden md:table-cell">{r.checkOut ? fmtTime(r.checkOut) : "-"}</TableCell>
              <TableCell className="hidden md:table-cell">{r.source}</TableCell>
              <TableCell className="hidden md:table-cell">{r.location}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">No attendance logs found</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// --- Login History ---

type LoginRow = Awaited<ReturnType<typeof getLoginHistory>>[number];

function LoginHistoryReport() {
  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(todayStr());
  const [rows, setRows] = useState<LoginRow[]>([]);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getLoginHistory(fromDate, toDate);
      setRows(data);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const parseEmail = (details: string) => {
    try { return JSON.parse(details).email ?? "-"; } catch { return "-"; }
  };

  const exportCsv = () => {
    downloadCsv(
      `login-history-${fromDate}-to-${toDate}.csv`,
      ["Actor Type", "Email", "Time"],
      rows.map((r) => [r.actorType, parseEmail(r.details), fmtTime(r.createdAt)])
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>From</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-full sm:w-40" />
        </div>
        <div>
          <Label>To</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-full sm:w-40" />
        </div>
        <Button onClick={load} disabled={isPending}>Load</Button>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Actor Type</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>
                <Badge variant={r.actorType === "worker" ? "default" : "secondary"}>{r.actorType}</Badge>
              </TableCell>
              <TableCell>{parseEmail(r.details)}</TableCell>
              <TableCell>{fmtTime(r.createdAt)}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground">No login records found</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// --- P&L Report ---

type PnlData = Awaited<ReturnType<typeof getProfitLossReport>>;

function PnlReport({ locations }: { locations: LocationOption[] }) {
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [locationId, setLocationId] = useState(() => locations.length === 1 ? String(locations[0].id) : "");
  const [data, setData] = useState<PnlData>({ revenue: 0, expenses: 0, net: 0, revenueByMode: {}, expensesByCategory: {} });
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const result = await getProfitLossReport(
        parseInt(month, 10),
        parseInt(year, 10),
        locationId ? parseInt(locationId, 10) : undefined
      );
      setData(result);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const exportCsv = () => {
    const rows: string[][] = [];
    rows.push(["Revenue", "", ""]);
    for (const [mode, amt] of Object.entries(data.revenueByMode)) {
      rows.push(["", mode, String(amt)]);
    }
    rows.push(["Total Revenue", "", String(data.revenue)]);
    rows.push(["", "", ""]);
    rows.push(["Expenses", "", ""]);
    for (const [cat, amt] of Object.entries(data.expensesByCategory)) {
      rows.push(["", cat, String(amt)]);
    }
    rows.push(["Total Expenses", "", String(data.expenses)]);
    rows.push(["", "", ""]);
    rows.push(["Net Profit/Loss", "", String(data.net)]);
    downloadCsv(`pnl-report-${year}-${month}.csv`, ["Section", "Detail", "Amount"], rows);
  };

  const months = [
    { value: "1", label: "January" }, { value: "2", label: "February" }, { value: "3", label: "March" },
    { value: "4", label: "April" }, { value: "5", label: "May" }, { value: "6", label: "June" },
    { value: "7", label: "July" }, { value: "8", label: "August" }, { value: "9", label: "September" },
    { value: "10", label: "October" }, { value: "11", label: "November" }, { value: "12", label: "December" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Month</Label>
          <Select value={month} onValueChange={(v) => setMonth(v ?? "1")}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Year</Label>
          <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="w-24" />
        </div>
        {locations.length > 1 ? (
          <div>
            <Label>Location</Label>
            <Select value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All locations">{locationId ? locations.find((l) => String(l.id) === locationId)?.name ?? "All Locations" : "All Locations"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Locations</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : locations.length === 1 ? (
          <div>
            <Label>Location</Label>
            <span className="flex h-9 items-center text-sm text-muted-foreground">{locations[0].name}</span>
          </div>
        ) : null}
        <Button onClick={load} disabled={isPending}>Load</Button>
        <Button variant="outline" onClick={exportCsv} disabled={data.revenue === 0 && data.expenses === 0}>Export CSV</Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Revenue</CardTitle></CardHeader>
          <CardContent><p className="text-xl md:text-2xl font-bold text-green-600">{data.revenue.toFixed(2)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Expenses</CardTitle></CardHeader>
          <CardContent><p className="text-xl md:text-2xl font-bold text-red-600">{data.expenses.toFixed(2)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Net Profit/Loss</CardTitle></CardHeader>
          <CardContent><p className={`text-xl md:text-2xl font-bold ${data.net >= 0 ? "text-green-600" : "text-red-600"}`}>{data.net.toFixed(2)}</p></CardContent>
        </Card>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Revenue by Payment Mode</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(data.revenueByMode).map(([mode, amt]) => (
                  <TableRow key={mode}>
                    <TableCell>{mode}</TableCell>
                    <TableCell className="text-right">{amt.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {Object.keys(data.revenueByMode).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground">No revenue data</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Expenses by Category</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(data.expensesByCategory).map(([cat, amt]) => (
                  <TableRow key={cat}>
                    <TableCell>{cat}</TableCell>
                    <TableCell className="text-right">{amt.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                {Object.keys(data.expensesByCategory).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="text-center text-muted-foreground">No expense data</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// --- Membership Matrix ---

type MatrixRow = Awaited<ReturnType<typeof getMembershipMatrix>>[number];

function MembershipMatrixReport({ locations }: { locations: LocationOption[] }) {
  const [locationId, setLocationId] = useState(() => locations.length === 1 ? String(locations[0].id) : "");
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getMembershipMatrix(
        locationId ? parseInt(locationId, 10) : undefined
      );
      setRows(data);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const exportCsv = () => {
    downloadCsv(
      `membership-matrix.csv`,
      ["Plan", "Active", "Cancelled", "Total"],
      rows.map((r) => [r.planName, String(r.active), String(r.cancelled), String(r.total)])
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {locations.length > 1 ? (
          <div>
            <Label>Location</Label>
            <Select value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All locations">{locationId ? locations.find((l) => String(l.id) === locationId)?.name ?? "All Locations" : "All Locations"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Locations</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : locations.length === 1 ? (
          <div>
            <Label>Location</Label>
            <span className="flex h-9 items-center text-sm text-muted-foreground">{locations[0].name}</span>
          </div>
        ) : null}
        <Button onClick={load} disabled={isPending}>Load</Button>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Plan</TableHead>
            <TableHead className="text-right">Active</TableHead>
            <TableHead className="text-right">Cancelled</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.planName}>
              <TableCell>{r.planName}</TableCell>
              <TableCell className="text-right">{r.active}</TableCell>
              <TableCell className="text-right">{r.cancelled}</TableCell>
              <TableCell className="text-right">{r.total}</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">No membership data found</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// --- Source Analysis ---

type SourceRow = Awaited<ReturnType<typeof getSourceAnalysis>>[number];

function SourceAnalysisReport({ locations }: { locations: LocationOption[] }) {
  const [locationId, setLocationId] = useState(() => locations.length === 1 ? String(locations[0].id) : "");
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getSourceAnalysis(
        locationId ? parseInt(locationId, 10) : undefined
      );
      setRows(data);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const exportCsv = () => {
    downloadCsv(
      `source-analysis.csv`,
      ["Source", "Total Enquiries", "Converted", "Conversion Rate (%)"],
      rows.map((r) => [r.source, String(r.total), String(r.converted), String(r.conversionRate)])
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        {locations.length > 1 ? (
          <div>
            <Label>Location</Label>
            <Select value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All locations">{locationId ? locations.find((l) => String(l.id) === locationId)?.name ?? "All Locations" : "All Locations"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">All Locations</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : locations.length === 1 ? (
          <div>
            <Label>Location</Label>
            <span className="flex h-9 items-center text-sm text-muted-foreground">{locations[0].name}</span>
          </div>
        ) : null}
        <Button onClick={load} disabled={isPending}>Load</Button>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Total Enquiries</TableHead>
            <TableHead className="text-right">Converted</TableHead>
            <TableHead className="text-right">Conversion Rate (%)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.source}>
              <TableCell>{r.source}</TableCell>
              <TableCell className="text-right">{r.total}</TableCell>
              <TableCell className="text-right">{r.converted}</TableCell>
              <TableCell className="text-right">{r.conversionRate}%</TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">No enquiry data found</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// --- Main Page ---

export default function ReportsPage() {
  const [locations, setLocations] = useState<LocationOption[]>([]);

  useEffect(() => {
    getLocations().then(setLocations);
  }, []);

  const activeLocations = locations.filter((l) => l.isActive);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Reports</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <Link href="/admin/reports/irregular">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Irregular Members</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Active members who haven&apos;t visited recently</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/reports/conversion-funnel">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Conversion Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Enquiry stage progression and conversion rates</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/reports/kpi">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">KPI Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Revenue, members, attendance and churn trends</p>
            </CardContent>
          </Card>
        </Link>
        <Link href="/admin/reports/member-usage">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Member Usage Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">Visit frequency segmentation: heavy, moderate, light users</p>
            </CardContent>
          </Card>
        </Link>
      </div>
      <Tabs defaultValue="collection">
        <TabsList className="overflow-x-auto max-w-full">
          <TabsTrigger value="collection">Daily Collection</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
          <TabsTrigger value="logins">Login History</TabsTrigger>
          <TabsTrigger value="pnl">P&L Report</TabsTrigger>
          <TabsTrigger value="matrix">Membership Matrix</TabsTrigger>
          <TabsTrigger value="source">Source Analysis</TabsTrigger>
          <TabsTrigger value="monthly-revenue">Monthly Revenue</TabsTrigger>
        </TabsList>
        <TabsContent value="collection">
          <Card>
            <CardHeader>
              <CardTitle>Daily Collection Report</CardTitle>
            </CardHeader>
            <CardContent>
              <CollectionReport locations={activeLocations} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="members">
          <Card>
            <CardHeader>
              <CardTitle>Member Report</CardTitle>
            </CardHeader>
            <CardContent>
              <MemberReport locations={activeLocations} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="attendance">
          <Card>
            <CardHeader>
              <CardTitle>Attendance Report</CardTitle>
            </CardHeader>
            <CardContent>
              <AttendanceReport locations={activeLocations} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="logins">
          <Card>
            <CardHeader>
              <CardTitle>Login History</CardTitle>
            </CardHeader>
            <CardContent>
              <LoginHistoryReport />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="pnl">
          <Card>
            <CardHeader>
              <CardTitle>P&L Report</CardTitle>
            </CardHeader>
            <CardContent>
              <PnlReport locations={activeLocations} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="matrix">
          <Card>
            <CardHeader>
              <CardTitle>Membership Matrix</CardTitle>
            </CardHeader>
            <CardContent>
              <MembershipMatrixReport locations={activeLocations} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="source">
          <Card>
            <CardHeader>
              <CardTitle>Source Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <SourceAnalysisReport locations={activeLocations} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="monthly-revenue">
          <Card>
            <CardHeader>
              <CardTitle>Monthly Revenue Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <MonthlyRevenueTrend />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MonthlyRevenueTrend() {
  const [data, setData] = useState<{
    month: string;
    revenue: number;
    expenses: number;
    net: number;
    cash: number;
    upi: number;
    renewals: number;
    newMembers: number;
  }[]>([]);
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    startLoading(async () => {
      const result = await getMonthlyRevenueTrendAction(12);
      setData(result);
    });
  }, []);

  const formatMonth = (m: string) => {
    const [y, mo] = m.split("-");
    const d = new Date(Number(y), Number(mo) - 1);
    return d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  };

  const fmtINR = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);

  if (loading) return <p className="text-muted-foreground py-4 text-center">Loading...</p>;

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right hidden md:table-cell">Expenses</TableHead>
            <TableHead className="text-right">Net</TableHead>
            <TableHead className="text-right hidden md:table-cell">Cash</TableHead>
            <TableHead className="text-right hidden md:table-cell">UPI</TableHead>
            <TableHead className="text-right hidden lg:table-cell">Renewals</TableHead>
            <TableHead className="text-right hidden lg:table-cell">New Members</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row) => (
            <TableRow key={row.month}>
              <TableCell className="font-medium">{formatMonth(row.month)}</TableCell>
              <TableCell className="text-right">{fmtINR(row.revenue)}</TableCell>
              <TableCell className="text-right hidden md:table-cell">{fmtINR(row.expenses)}</TableCell>
              <TableCell className={`text-right font-semibold ${row.net >= 0 ? "text-green-600" : "text-red-600"}`}>
                {fmtINR(row.net)}
              </TableCell>
              <TableCell className="text-right hidden md:table-cell">{fmtINR(row.cash)}</TableCell>
              <TableCell className="text-right hidden md:table-cell">{fmtINR(row.upi)}</TableCell>
              <TableCell className="text-right hidden lg:table-cell">{row.renewals}</TableCell>
              <TableCell className="text-right hidden lg:table-cell">{row.newMembers}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
