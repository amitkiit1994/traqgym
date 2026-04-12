"use client";

import { useEffect, useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import {
  getLeaveRequests,
  createLeaveRequest,
  reviewLeaveRequest,
  getLeaveBalance,
} from "@/lib/actions/leaves";
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

type LeaveRow = {
  id: number;
  workerId: number;
  workerName: string;
  workerRole: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: string;
  reviewedBy: number | null;
  reviewedAt: string | null;
  createdAt: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusBadgeVariant(status: string) {
  if (status === "approved") return "default" as const;
  if (status === "rejected") return "destructive" as const;
  return "secondary" as const;
}

export default function LeavesPage() {
  const { data: session } = useSession();
  const [statusFilter, setStatusFilter] = useState("all");
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [leaveType, setLeaveType] = useState("casual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [formResult, setFormResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [balance, setBalance] = useState<Record<string, { quota: number; used: number; remaining: number }> | null>(null);

  const currentUser = session?.user as any;
  const isAdmin = currentUser?.role === "admin";
  const currentWorkerId = currentUser?.id ? parseInt(currentUser.id, 10) : 0;

  const loadData = () => {
    startTransition(async () => {
      const data = await getLeaveRequests(
        statusFilter === "all" ? undefined : statusFilter
      );
      setRows(data);
    });
  };

  const loadBalance = () => {
    if (currentWorkerId) {
      getLeaveBalance(currentWorkerId).then((b) => setBalance(b));
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    loadBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentWorkerId]);

  const handleCreate = () => {
    if (!startDate || !endDate) return;
    startTransition(async () => {
      const res = await createLeaveRequest(currentWorkerId, {
        leaveType,
        startDate,
        endDate,
        reason: reason || undefined,
      });
      if (res.success) {
        setFormResult("Leave request submitted");
        setShowForm(false);
        setLeaveType("casual");
        setStartDate("");
        setEndDate("");
        setReason("");
        loadData();
        loadBalance();
      } else {
        setFormResult("error" in res ? res.error ?? "Error" : "Error");
      }
    });
  };

  const handleReview = (id: number, status: "approved" | "rejected") => {
    startTransition(async () => {
      const res = await reviewLeaveRequest(id, status, currentWorkerId);
      if (res.success) {
        setFormResult(`Leave ${status}`);
        loadData();
      } else {
        setFormResult("error" in res ? res.error ?? "Error" : "Error");
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Leaves</h1>
        <Button onClick={() => { setShowForm(!showForm); setFormResult(null); }}>
          {showForm ? "Cancel" : "Request Leave"}
        </Button>
      </div>

      {/* Leave Balance */}
      {balance && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(["casual", "sick", "personal"] as const).map((type) => (
            <Card key={type}>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground capitalize">{type} Leave</p>
                <p className="text-xl md:text-2xl font-semibold">
                  {balance[type].remaining}
                  <span className="text-sm font-normal text-muted-foreground"> / {balance[type].quota}</span>
                </p>
                <p className="text-xs text-muted-foreground">{balance[type].used} used this year</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-1 border-b">
        {["all", "pending", "approved", "rejected"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize ${
              statusFilter === s
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {s === "all" ? "All" : s}
          </button>
        ))}
      </div>

      {/* Request Leave Form */}
      {showForm && (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Request Leave</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="leave-type">Type</Label>
              <select
                id="leave-type"
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value)}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
              >
                <option value="casual">Casual</option>
                <option value="sick">Sick</option>
                <option value="personal">Personal</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="leave-start">Start Date</Label>
              <Input
                id="leave-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="leave-end">End Date</Label>
              <Input
                id="leave-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="leave-reason">Reason (optional)</Label>
              <Input
                id="leave-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason for leave"
              />
            </div>
            <Button onClick={handleCreate} disabled={isPending || !startDate || !endDate}>
              {isPending ? "Submitting..." : "Submit Request"}
            </Button>
          </CardContent>
        </Card>
      )}

      {formResult && (
        <p className="text-sm text-muted-foreground">{formResult}</p>
      )}

      {/* Leave Requests Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Worker</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="hidden md:table-cell">Start</TableHead>
            <TableHead className="hidden md:table-cell">End</TableHead>
            <TableHead className="hidden md:table-cell">Reason</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.workerName}</TableCell>
              <TableCell className="capitalize">{r.leaveType}</TableCell>
              <TableCell className="hidden md:table-cell">{formatDate(r.startDate)}</TableCell>
              <TableCell className="hidden md:table-cell">{formatDate(r.endDate)}</TableCell>
              <TableCell className="hidden md:table-cell">{r.reason || "-"}</TableCell>
              <TableCell>
                <Badge variant={statusBadgeVariant(r.status)} className="capitalize">
                  {r.status}
                </Badge>
              </TableCell>
              <TableCell>
                {r.status === "pending" && isAdmin && (
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleReview(r.id, "approved")}
                      disabled={isPending}
                    >
                      Approve
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleReview(r.id, "rejected")}
                      disabled={isPending}
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No leave requests
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
