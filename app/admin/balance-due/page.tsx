"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getBalanceDueReportAction,
  recordPartialPaymentAction,
} from "@/lib/actions/partial-payment";
import { getLocations } from "@/lib/actions/locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { IndianRupee, MessageCircle, Loader2, Download } from "lucide-react";
import { toCsv } from "@/lib/utils/csv-export";
import { SearchInput } from "@/components/ui/search-input";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { TablePagination } from "@/components/ui/table-pagination";

type BalanceRow = {
  userId: number;
  memberName: string;
  phone: string;
  planName: string;
  ticketId: number;
  totalAmount: number | null;
  amountPaid: number;
  balanceDue: number;
  dueDate: string | null;
  expireDate: string;
};

const PAGE_SIZE = 25;

export default function BalanceDuePage() {
  const [data, setData] = useState<BalanceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [grandTotalDue, setGrandTotalDue] = useState(0);
  const [page, setPage] = useState(1);
  const [locations, setLocations] = useState<{ id: number; name: string }[]>([]);
  const [locationId, setLocationId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("balanceDue");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [loading, startTransition] = useTransition();
  const [payDialog, setPayDialog] = useState<BalanceRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState("cash");
  const [upiRef, setUpiRef] = useState("");
  const [paying, startPaying] = useTransition();

  const fetchData = (p?: number, search?: string) => {
    const currentPage = p ?? page;
    const currentSearch = search ?? searchQuery;
    startTransition(async () => {
      const loc = locationId === "all" ? undefined : Number(locationId);
      const result = await getBalanceDueReportAction({
        locationId: loc,
        search: currentSearch || undefined,
        page: currentPage,
        pageSize: PAGE_SIZE,
        sortBy,
        sortOrder,
        status: statusFilter,
      });
      setData(result.data);
      setTotal(result.total);
      setGrandTotalDue(result.totalDue);
    });
  };

  useEffect(() => {
    getLocations().then((l) => {
      setLocations(l);
      if (l.length === 1) setLocationId(String(l[0].id));
    });
  }, []);

  useEffect(() => {
    setPage(1);
    fetchData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, sortBy, sortOrder, statusFilter]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleExport = () => {
    const headers = ["Name", "Phone", "Total", "Paid", "Due"];
    const rows = data.map((d) => [
      d.memberName,
      d.phone ?? "",
      String(d.totalAmount ?? ""),
      String(d.amountPaid),
      String(d.balanceDue),
    ]);
    const csv = toCsv(headers, rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `balance-due-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePay = () => {
    if (!payDialog) return;
    const amount = parseFloat(payAmount);
    if (!amount || amount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    startPaying(async () => {
      const result = await recordPartialPaymentAction({
        ticketId: payDialog.ticketId,
        amount,
        paymentMode: payMode,
        upiReference: payMode === "upi" ? upiRef : undefined,
      });
      if (result.success) {
        toast.success(
          result.isFullyPaid
            ? "Balance cleared!"
            : `Payment recorded. Remaining: Rs ${result.newBalanceDue}`
        );
        setPayDialog(null);
        setPayAmount("");
        setUpiRef("");
        fetchData();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="shrink-0 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl md:text-2xl font-bold">Balance Due Report</h1>
          <div className="flex gap-2 items-center">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={data.length === 0}>
              <Download className="size-4" />
              Export
            </Button>
          {locations.length > 1 ? (
            <Select value={locationId} onValueChange={(v) => setLocationId(v ?? "all")}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : locations.length === 1 ? (
            <span className="text-sm text-muted-foreground">{locations[0].name}</span>
          ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput
            placeholder="Search by name or phone..."
            defaultValue={searchQuery}
            onSearch={(q) => {
              setSearchQuery(q);
              setPage(1);
              fetchData(1, q);
            }}
            isPending={loading}
            className="w-full sm:w-72"
          />
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => setStatusFilter("active")}
              className={`px-3 py-1 text-xs rounded-sm transition-colors ${
                statusFilter === "active"
                  ? "bg-background shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Active only
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`px-3 py-1 text-xs rounded-sm transition-colors ${
                statusFilter === "all"
                  ? "bg-background shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Include cancelled / expired
            </button>
          </div>
        </div>
      </div>

      <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-center gap-2">
          <IndianRupee className="h-5 w-5 text-destructive" />
          <CardTitle className="text-lg">
            Total Outstanding: Rs {grandTotalDue.toLocaleString("en-IN")}
          </CardTitle>
          <Badge variant="secondary" className="ml-auto">
            {total} member{total !== 1 ? "s" : ""}
          </Badge>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <p className="text-muted-foreground py-8 text-center">Loading...</p>
          ) : data.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              No outstanding balances
            </p>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead field="memberName" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>Member</SortableTableHead>
                    <TableHead className="hidden md:table-cell">Phone</TableHead>
                    <TableHead className="hidden md:table-cell">Plan</TableHead>
                    <SortableTableHead field="totalAmount" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="hidden md:table-cell text-right">Total</SortableTableHead>
                    <TableHead className="hidden md:table-cell text-right">Paid</TableHead>
                    <SortableTableHead field="balanceDue" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="text-right">Due</SortableTableHead>
                    <SortableTableHead field="dueDate" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="hidden md:table-cell">Due Date</SortableTableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((row) => {
                    const expireDays = Math.floor(
                      (Date.now() - new Date(row.expireDate).getTime()) / (1000 * 60 * 60 * 24)
                    );
                    const rowBg = expireDays > 30
                      ? "bg-destructive/5"
                      : expireDays > 7
                        ? "bg-status-expiring/10"
                        : "";
                    return (
                    <TableRow key={row.ticketId} className={`${rowBg} ${expireDays > 90 ? "opacity-60" : ""}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          {row.memberName}
                          {expireDays > 90 && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0">Unlikely</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {row.phone ? (
                          <a href={`tel:${row.phone}`} className="hover:underline">{row.phone}</a>
                        ) : "-"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{row.planName}</TableCell>
                      <TableCell className="hidden md:table-cell text-right">
                        {row.totalAmount?.toLocaleString("en-IN") ?? "-"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-right">
                        {row.amountPaid.toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-destructive">
                        {row.balanceDue.toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {row.dueDate
                          ? new Date(row.dueDate).toLocaleDateString("en-IN")
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            onClick={() => {
                              setPayDialog(row);
                              setPayAmount(String(row.balanceDue));
                            }}
                          >
                            Record Payment
                          </Button>
                          {row.phone && (
                            <a
                              href={`https://wa.me/${row.phone.replace(/\D/g, "")}?text=${encodeURIComponent("Hi " + row.memberName + ", you have an outstanding balance of Rs." + row.balanceDue.toLocaleString("en-IN") + ". Please visit the gym to make your payment.")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center rounded-md p-2 text-status-active hover:text-status-active-foreground hover:bg-accent"
                            >
                              <MessageCircle className="size-3.5" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
          )}
        </CardContent>
      </Card>

      <div className="shrink-0">
        <TablePagination
          page={page}
          totalPages={totalPages}
          total={total}
          pageSize={PAGE_SIZE}
          onPageChange={(p) => {
            setPage(p);
            fetchData(p);
          }}
          disabled={loading}
        />
      </div>

      <Dialog open={!!payDialog} onOpenChange={() => setPayDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Record Payment — {payDialog?.memberName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Balance due: Rs {payDialog?.balanceDue.toLocaleString("en-IN")}
            </p>
            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                max={payDialog?.balanceDue}
                min={1}
              />
            </div>
            <div>
              <Label>Payment Mode</Label>
              <Select value={payMode} onValueChange={(v) => setPayMode(v ?? "cash")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {payMode === "upi" && (
              <div>
                <Label>UPI Reference</Label>
                <Input
                  value={upiRef}
                  onChange={(e) => setUpiRef(e.target.value)}
                  placeholder="Transaction ID"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handlePay} disabled={paying}>
              {paying && <Loader2 className="size-4 animate-spin" />}
              {paying ? "Processing..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
