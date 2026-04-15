"use client";

import { Fragment, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { getAuditLogs } from "@/lib/actions/audit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AuditLog = {
  id: number;
  action: string;
  status: string;
  details: string | null;
  actorId: number | null;
  actorType: string | null;
  createdAt: string;
};

const PAGE_SIZE = 25;

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isInitialMount = useRef(true);

  const load = useCallback(
    (p?: number) => {
      const currentPage = p ?? page;
      startTransition(async () => {
        const data = await getAuditLogs(
          fromDate || undefined,
          toDate || undefined,
          actionFilter || undefined,
          currentPage,
          PAGE_SIZE,
        );
        setLogs(data.logs);
        setTotal(data.total);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromDate, toDate, actionFilter],
  );

  // Initial load
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when filters change (skip initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setPage(1);
    load(1);
  }, [fromDate, toDate, actionFilter, load]);

  const goToPage = (p: number) => {
    setPage(p);
    load(p);
  };

  const formatDetails = (details: string | null) => {
    if (!details) return "No details";
    try {
      return JSON.stringify(JSON.parse(details), null, 2);
    } catch {
      return details;
    }
  };

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="shrink-0 space-y-3">
      <h1 className="text-xl font-semibold">Audit Log</h1>

      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 sm:items-end sm:flex-wrap">
        <div>
          <Label>From</Label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <Label>To</Label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <Label>Action</Label>
          <SearchInput
            placeholder="Filter by action..."
            onSearch={setActionFilter}
            isPending={isPending}
            className="w-48"
          />
        </div>
      </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="hidden sm:table-cell">Timestamp</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Actor</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <Fragment key={log.id}>
              <TableRow>
                <TableCell className="whitespace-nowrap hidden sm:table-cell">
                  {new Date(log.createdAt).toLocaleString("en-IN")}
                </TableCell>
                <TableCell>{log.action}</TableCell>
                <TableCell>
                  <Badge
                    variant={log.status === "success" ? "default" : "destructive"}
                  >
                    {log.status}
                  </Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {log.actorType
                    ? `${log.actorType}:${log.actorId}`
                    : "system"}
                </TableCell>
                <TableCell>
                  {log.details && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExpandedId(expandedId === log.id ? null : log.id)
                      }
                    >
                      {expandedId === log.id ? "Hide" : "Show"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
              {expandedId === log.id && log.details && (
                <TableRow key={`${log.id}-details`}>
                  <TableCell colSpan={5}>
                    <pre className="bg-muted p-3 rounded text-xs overflow-auto max-h-48">
                      {formatDetails(log.details)}
                    </pre>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
          {logs.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No audit logs found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>

      {totalPages > 1 && (
        <div className="shrink-0">
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1 || isPending}
            onClick={() => goToPage(page - 1)}
          >
            Prev
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || isPending}
            onClick={() => goToPage(page + 1)}
          >
            Next
          </Button>
        </div>
        </div>
      )}
    </div>
  );
}
