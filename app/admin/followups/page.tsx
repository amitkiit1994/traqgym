"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getFollowupsAction,
  updateFollowupAction,
  assignFollowupAction,
  createFollowupAction,
} from "@/lib/actions/payment-followup";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { MessageCircle } from "lucide-react";

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
};

const STATUS_OPTIONS = ["pending", "contacted", "promised", "resolved", "written_off"];
const PRIORITY_OPTIONS = ["low", "normal", "high", "critical"];

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
  const [data, setData] = useState<Followup[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [loading, startTransition] = useTransition();
  const [editDialog, setEditDialog] = useState<Followup | null>(null);
  const [editStatus, setEditStatus] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editPriority, setEditPriority] = useState("");
  const [saving, startSaving] = useTransition();

  const fetchData = () => {
    startTransition(async () => {
      const result = await getFollowupsAction({
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setData(result);
    });
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

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

  const sorted = [...data].sort((a, b) => getDaysOverdue(b.dueDate) - getDaysOverdue(a.dueDate));

  const totalDue = data.reduce((s, d) => s + d.amountDue, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Payment Followups</h1>
        <div className="flex gap-2">
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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {data.length} followup{data.length !== 1 ? "s" : ""} — Total due: Rs{" "}
            {totalDue.toLocaleString("en-IN")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground py-8 text-center">Loading...</p>
          ) : data.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              No followups found
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Amount Due</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Days Overdue</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned To</TableHead>
                    <TableHead>Last Contacted</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((f) => {
                    const days = getDaysOverdue(f.dueDate);
                    return (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">
                        {f.memberName}
                      </TableCell>
                      <TableCell>
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
                      <TableCell>
                        {new Date(f.dueDate).toLocaleDateString("en-IN")}
                      </TableCell>
                      <TableCell>
                        {days > 0 ? (
                          <span className="text-destructive font-medium">{days}d overdue</span>
                        ) : days >= -3 ? (
                          <span className="text-yellow-600 font-medium">Due in {Math.abs(days)}d</span>
                        ) : (
                          <span className="text-muted-foreground">Due in {Math.abs(days)}d</span>
                        )}
                      </TableCell>
                      <TableCell>
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
                      <TableCell>
                        {f.assignedTo?.name || "-"}
                      </TableCell>
                      <TableCell>
                        {f.lastContactedAt
                          ? new Date(f.lastContactedAt).toLocaleDateString("en-IN")
                          : "-"}
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
            </div>
          )}
        </CardContent>
      </Card>

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
