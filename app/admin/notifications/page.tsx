"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import {
  getNotificationLogs,
  getNotificationAnalytics,
  resendFailedNotification,
  exportNotificationLogsCsv,
} from "@/lib/actions/notifications";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  MessageSquare,
  Smartphone,
  Mail,
  RefreshCw,
  Download,
  Search,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type NotifRow = {
  id: number;
  memberName: string;
  templateName: string;
  channel: string;
  recipient: string | null;
  status: string;
  errorMessage: string | null;
  deliveryDate: string;
  sentAt: string | null;
  createdAt: string;
};

type Analytics = {
  total: number;
  sent: number;
  failed: number;
  pending: number;
  successRate: number;
  channelBreakdown: { channel: string; count: number }[];
};

const statusVariant: Record<string, "default" | "destructive" | "secondary"> = {
  sent: "default",
  pending: "secondary",
  failed: "destructive",
};

const channelIcons: Record<string, React.ReactNode> = {
  whatsapp: <MessageSquare className="size-3.5" />,
  sms: <Smartphone className="size-3.5" />,
  email: <Mail className="size-3.5" />,
};

function formatTemplate(name: string) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function NotificationsPage() {
  const [logs, setLogs] = useState<NotifRow[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [expandedErrors, setExpandedErrors] = useState<Set<number>>(new Set());
  const [resending, setResending] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const pageSize = 50;

  const getFilters = useCallback(() => ({
    status: statusFilter === "all" ? undefined : statusFilter,
    search: search || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }), [statusFilter, search, dateFrom, dateTo]);

  const loadData = useCallback((p: number) => {
    startTransition(async () => {
      const filters = getFilters();
      const [data, stats] = await Promise.all([
        getNotificationLogs({
          ...filters,
          limit: pageSize,
          offset: (p - 1) * pageSize,
        }),
        getNotificationAnalytics({
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        }),
      ]);
      setLogs(data);
      setHasMore(data.length === pageSize);
      setAnalytics(stats);
    });
  }, [getFilters]);

  useEffect(() => {
    setPage(1);
    loadData(1);
  }, [statusFilter, loadData]);

  const handleSearch = () => {
    setPage(1);
    loadData(1);
  };

  const handleResend = async (id: number) => {
    setResending(id);
    const result = await resendFailedNotification(id);
    setResending(null);
    if (result.success) {
      toast.success("Notification resent successfully");
      loadData(page);
    } else {
      toast.error(result.error || "Failed to resend");
    }
  };

  const handleExport = async () => {
    const csv = await exportNotificationLogsCsv(getFilters());
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `notifications-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  const toggleError = (id: number) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Notification Log</h1>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="size-4 mr-1.5" />
          Export CSV
        </Button>
      </div>

      {/* Analytics Cards */}
      {analytics && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Total</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 pt-0">
              <p className="text-2xl font-bold">{analytics.total}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Sent</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 pt-0">
              <p className="text-2xl font-bold text-green-600">{analytics.sent}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Failed</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 pt-0">
              <p className="text-2xl font-bold text-red-600">{analytics.failed}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Pending</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 pt-0">
              <p className="text-2xl font-bold text-yellow-600">{analytics.pending}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">Success Rate</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 pt-0">
              <p className="text-2xl font-bold">{analytics.successRate}%</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Channel Breakdown */}
      {analytics && analytics.channelBreakdown.length > 0 && (
        <div className="flex gap-3 items-center text-sm">
          <span className="text-muted-foreground">By channel:</span>
          {analytics.channelBreakdown.map((c) => (
            <span key={c.channel} className="flex items-center gap-1.5">
              {channelIcons[c.channel] || null}
              <span className="capitalize">{c.channel}</span>
              <Badge variant="secondary">{c.count}</Badge>
            </span>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex gap-1 items-center">
          {["all", "sent", "pending", "failed"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 text-sm rounded-md capitalize ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <Input
            type="text"
            placeholder="Search member..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="w-44 h-8"
          />
          <Button variant="outline" size="sm" onClick={handleSearch} className="h-8">
            <Search className="size-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-36 h-8"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36 h-8"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={handleSearch}
            className="h-8"
          >
            Apply
          </Button>
          {(dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setDateFrom(""); setDateTo(""); setTimeout(() => handleSearch(), 0); }}
              className="h-8 text-xs"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Template</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>Recipient</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Sent At</TableHead>
            <TableHead className="w-20">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((n) => (
            <TableRow key={n.id}>
              <TableCell className="font-medium">{n.memberName}</TableCell>
              <TableCell className="text-sm">{formatTemplate(n.templateName)}</TableCell>
              <TableCell>
                <span className="flex items-center gap-1.5">
                  {channelIcons[n.channel] || null}
                  <span className="capitalize text-sm">{n.channel}</span>
                </span>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{n.recipient || "-"}</TableCell>
              <TableCell>
                <div>
                  <Badge variant={statusVariant[n.status] ?? "secondary"}>
                    {n.status}
                  </Badge>
                  {n.status === "failed" && n.errorMessage && (
                    <button
                      onClick={() => toggleError(n.id)}
                      className="flex items-center gap-0.5 text-xs text-destructive mt-1 hover:underline"
                    >
                      {expandedErrors.has(n.id) ? (
                        <>
                          <ChevronUp className="size-3" />
                          Hide error
                        </>
                      ) : (
                        <>
                          <ChevronDown className="size-3" />
                          Show error
                        </>
                      )}
                    </button>
                  )}
                  {expandedErrors.has(n.id) && n.errorMessage && (
                    <p className="text-xs text-destructive mt-1 max-w-[300px] whitespace-pre-wrap break-all">
                      {n.errorMessage}
                    </p>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-sm">
                {new Date(n.deliveryDate).toLocaleDateString("en-IN")}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {n.sentAt
                  ? new Date(n.sentAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
                  : "-"}
              </TableCell>
              <TableCell>
                {n.status === "failed" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={resending === n.id}
                    onClick={() => handleResend(n.id)}
                    className="h-7 px-2"
                  >
                    <RefreshCw className={`size-3.5 ${resending === n.id ? "animate-spin" : ""}`} />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {logs.length === 0 && !isPending && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                No notifications found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 1 || isPending}
          onClick={() => { setPage(page - 1); loadData(page - 1); }}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">Page {page}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasMore || isPending}
          onClick={() => { setPage(page + 1); loadData(page + 1); }}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
