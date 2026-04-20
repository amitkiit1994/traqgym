"use client";

import { useEffect, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  getFollowupsAction,
  updateFollowupAction,
} from "@/lib/actions/payment-followup";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { MessageCircle, Archive } from "lucide-react";
import { SearchInput } from "@/components/ui/search-input";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { TablePagination } from "@/components/ui/table-pagination";

type Followup = {
  id: number;
  userId: number;
  memberName: string;
  phone: string;
  memberTicketId: number | null;
  amountDue: number;
  dueDate: string;
  assignedTo: { id: number; name: string } | null;
  status: string;
  priority: string;
  notes: string | null;
  lastContactedAt: string | null;
  nextFollowupAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  relevance: number;
  suggestion: string;
};

const STATUS_OPTIONS = ["pending", "contacted", "promised", "resolved", "written_off"];
const PRIORITY_OPTIONS = ["low", "normal", "high", "critical"];
const PAGE_SIZE = 25;

const priorityColor: Record<string, string> = {
  critical: "destructive",
  high: "destructive",
  normal: "secondary",
  low: "outline",
};

const statusColor: Record<string, string> = {
  pending: "secondary",
  contacted: "default",
  promised: "default",
  resolved: "outline",
  written_off: "outline",
};

export default function FollowupsPage() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<Followup[]>([]);
  const [total, setTotal] = useState(0);
  const [grandTotalDue, setGrandTotalDue] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>(() => {
    const urlStatus = searchParams.get("status");
    if (urlStatus === "overdue") return "pending";
    if (urlStatus && STATUS_OPTIONS.includes(urlStatus)) return urlStatus;
    return "pending";
  });
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("dueDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [loading, startTransition] = useTransition();
  const [editDialog, setEditDialog] = useState<Followup | null>(null);
  const [editStatus, setEditStatus] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const [saving, startSaving] = useTransition();

  const fetchData = (p?: number, search?: string) => {
    const currentPage = p ?? page;
    const currentSearch = search ?? searchQuery;
    startTransition(async () => {
      const result = await getFollowupsAction({
        status: statusFilter === "all" ? undefined : statusFilter,
        showArchived,
        search: currentSearch || undefined,
        page: currentPage,
        pageSize: PAGE_SIZE,
        sortBy,
        sortOrder,
      });
      // For pending status with default dueDate sort, show overdue (most-overdue first) above future items.
      const shouldReorder =
        statusFilter === "pending" && sortBy === "dueDate" && sortOrder === "asc";
      let items = result.data;
      if (shouldReorder) {
        const nowMs = Date.now();
        const overdue = items
          .filter((f) => new Date(f.dueDate).getTime() < nowMs)
          .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());
        const future = items
          .filter((f) => new Date(f.dueDate).getTime() >= nowMs)
          .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
        items = [...overdue, ...future];
      }
      setData(items);
      setTotal(result.total);
      setGrandTotalDue(result.totalDue);
      setOverdueCount(result.overdueCount ?? 0);
    });
  };

  useEffect(() => {
    setPage(1);
    fetchData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, showArchived, sortBy, sortOrder]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  };

  const openEdit = (f: Followup) => {
    setEditDialog(f);
    setEditStatus(f.status);
    setEditNotes(f.notes || "");
    setEditPriority(f.priority);
  };

  const handleUpdate = () => {
    if (!editDialog) return;
    startSaving(async () => {
      const result = await updateFollowupAction(editDialog.id, {
        status: editStatus,
        notes: editNotes,
        priority: editPriority,
      });
      if (result.success) {
        toast.success("Followup updated");
        setEditDialog(null);
        fetchData();
      } else {
        toast.error(result.error);
      }
    });
  };

  const getDaysOverdue = (dueDate: string) =>
    Math.floor((Date.now() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="shrink-0 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-xl md:text-2xl font-bold">Payment Followups</h1>
            {overdueCount > 0 && (
              <Badge variant="destructive">{overdueCount} overdue</Badge>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {["all", ...STATUS_OPTIONS].map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(s)}
              >
                {s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ")}
              </Button>
            ))}
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
        <Button
          variant={showArchived ? "default" : "outline"}
          size="sm"
          onClick={() => setShowArchived(!showArchived)}
          className="gap-1.5"
        >
          <Archive className="size-3.5" />
          {showArchived ? "Showing all" : "Show archived (>90 days)"}
        </Button>
        </div>
      </div>

      <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <CardHeader>
          <CardTitle className="text-lg">
            {total} followup{total !== 1 ? "s" : ""} — Total due: Rs{" "}
            {grandTotalDue.toLocaleString("en-IN")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <p className="text-muted-foreground py-8 text-center">Loading...</p>
          ) : data.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              No followups found
            </p>
          ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead field="memberName" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>Member</SortableTableHead>
                    <TableHead className="hidden md:table-cell">Phone</TableHead>
                    <SortableTableHead field="amountDue" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="text-right">Amount Due</SortableTableHead>
                    <SortableTableHead field="dueDate" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="hidden md:table-cell">Due Date</SortableTableHead>
                    <TableHead className="hidden md:table-cell">Days Overdue</TableHead>
                    <SortableTableHead field="priority" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} className="hidden lg:table-cell">Priority</SortableTableHead>
                    <SortableTableHead field="status" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort}>Status</SortableTableHead>
                    <TableHead className="hidden lg:table-cell">Assigned To</TableHead>
                    <TableHead className="hidden lg:table-cell">Last Contacted</TableHead>
                    <TableHead className="hidden xl:table-cell">Suggested Action</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((f) => {
                    const days = getDaysOverdue(f.dueDate);
                    return (
                    <TableRow key={f.id} className={f.relevance < 30 ? "opacity-60" : ""}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-block size-2 rounded-full ${
                              f.relevance >= 70
                                ? "bg-green-500"
                                : f.relevance >= 40
                                  ? "bg-yellow-500"
                                  : "bg-red-400"
                            }`}
                            title={`Relevance: ${f.relevance}`}
                          />
                          {f.memberName}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="flex items-center gap-1">
                          {f.phone ? (
                            <a href={`tel:${f.phone}`} className="hover:underline">{f.phone}</a>
                          ) : "-"}
                          {f.phone && (
                            <a
                              href={`https://wa.me/${f.phone.replace(/\D/g, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-green-600 hover:text-green-700"
                            >
                              <MessageCircle className="size-3.5" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        Rs {f.amountDue.toLocaleString("en-IN")}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {new Date(f.dueDate).toLocaleDateString("en-IN")}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {days > 0 ? (
                          <span className="text-destructive font-medium">{days}d overdue</span>
                        ) : days >= -3 ? (
                          <span className="text-yellow-600 font-medium">Due in {Math.abs(days)}d</span>
                        ) : (
                          <span className="text-muted-foreground">Due in {Math.abs(days)}d</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <Badge
                          variant={
                            (priorityColor[f.priority] as "destructive" | "secondary" | "outline" | "default") ||
                            "secondary"
                          }
                        >
                          {f.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            (statusColor[f.status] as "destructive" | "secondary" | "outline" | "default") ||
                            "secondary"
                          }
                        >
                          {f.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {f.assignedTo?.name || "-"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {f.lastContactedAt
                          ? new Date(f.lastContactedAt).toLocaleDateString("en-IN")
                          : "-"}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-xs text-muted-foreground max-w-[200px]">
                        {f.suggestion}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => openEdit(f)}>
                          Update
                        </Button>
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

      <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Followup — {editDialog?.memberName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={(v) => { if (v) setEditStatus(v); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={editPriority} onValueChange={(v) => { if (v) setEditPriority(v); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Contact notes..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={saving}>
              {saving ? "Saving..." : "Update"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
