"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createScheduleAction,
  getSchedulableTicketsAction,
} from "@/lib/actions/payment-schedule";

type SchedulableTicket = {
  ticketId: number;
  memberName: string;
  phone: string | null;
  planName: string;
  totalAmount: number | null;
  amountPaid: number;
  balanceDue: number;
};

type Row = {
  dueDate: string;
  amount: string;
};

function plusDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export function CreatePaymentScheduleDialog({
  open,
  onOpenChange,
  defaultTicketId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTicketId?: number;
  onCreated?: () => void;
}) {
  const [tickets, setTickets] = useState<SchedulableTicket[]>([]);
  const [ticketId, setTicketId] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([
    { dueDate: plusDaysISO(0), amount: "" },
    { dueDate: plusDaysISO(7), amount: "" },
    { dueDate: plusDaysISO(30), amount: "" },
  ]);
  const [loading, startLoading] = useTransition();
  const [submitting, startSubmitting] = useTransition();

  useEffect(() => {
    if (!open) return;
    startLoading(async () => {
      const list = await getSchedulableTicketsAction();
      setTickets(list);
      if (defaultTicketId) {
        setTicketId(String(defaultTicketId));
      }
    });
  }, [open, defaultTicketId]);

  const selected = tickets.find((t) => String(t.ticketId) === ticketId);
  const targetAmount = selected?.balanceDue ?? 0;
  const sum = rows.reduce((acc, r) => acc + (parseFloat(r.amount) || 0), 0);
  const sumValid = selected ? Math.abs(sum - targetAmount) < 0.01 : false;

  const updateRow = (index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    const lastDate = rows.length > 0 ? rows[rows.length - 1].dueDate : plusDaysISO(0);
    const next = new Date(lastDate);
    next.setDate(next.getDate() + 30);
    setRows((prev) => [
      ...prev,
      { dueDate: next.toISOString().split("T")[0], amount: "" },
    ]);
  };

  const removeRow = (index: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const reset = () => {
    setTicketId("");
    setRows([
      { dueDate: plusDaysISO(0), amount: "" },
      { dueDate: plusDaysISO(7), amount: "" },
      { dueDate: plusDaysISO(30), amount: "" },
    ]);
  };

  const handleSubmit = () => {
    if (!selected) {
      toast.error("Select a member ticket");
      return;
    }
    for (const r of rows) {
      if (!r.dueDate) {
        toast.error("Each installment needs a due date");
        return;
      }
      const amt = parseFloat(r.amount);
      if (!amt || amt <= 0) {
        toast.error("Each installment needs a positive amount");
        return;
      }
    }
    if (!sumValid) {
      toast.error(`Total must equal Rs ${targetAmount.toLocaleString("en-IN")}`);
      return;
    }

    startSubmitting(async () => {
      const result = await createScheduleAction({
        memberTicketId: selected.ticketId,
        installments: rows.map((r) => ({
          dueDate: r.dueDate,
          amount: parseFloat(r.amount),
        })),
      });
      if (result.success) {
        toast.success("Payment schedule created");
        reset();
        onOpenChange(false);
        onCreated?.();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Payment Schedule</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Member ticket</Label>
            {loading ? (
              <p className="text-sm text-muted-foreground py-2">Loading tickets...</p>
            ) : tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">
                No tickets with outstanding balance available for scheduling.
              </p>
            ) : (
              <Select value={ticketId} onValueChange={(v) => setTicketId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose ticket..." />
                </SelectTrigger>
                <SelectContent>
                  {tickets.map((t) => (
                    <SelectItem key={t.ticketId} value={String(t.ticketId)}>
                      {t.memberName} — {t.planName} (Due Rs{" "}
                      {t.balanceDue.toLocaleString("en-IN")})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {selected && (
            <div className="rounded-lg border border-border/40 bg-muted/30 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total ticket amount</span>
                <span>Rs {(selected.totalAmount ?? selected.balanceDue).toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Already paid</span>
                <span>Rs {selected.amountPaid.toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Balance to schedule</span>
                <span>Rs {selected.balanceDue.toLocaleString("en-IN")}</span>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Installments</Label>
              <Button type="button" size="sm" variant="outline" onClick={addRow}>
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div key={idx} className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">
                      #{idx + 1} Due date
                    </Label>
                    <Input
                      type="date"
                      value={row.dueDate}
                      onChange={(e) => updateRow(idx, { dueDate: e.target.value })}
                    />
                  </div>
                  <div className="w-32">
                    <Label className="text-xs text-muted-foreground">Amount</Label>
                    <Input
                      type="number"
                      min={1}
                      placeholder="0"
                      value={row.amount}
                      onChange={(e) => updateRow(idx, { amount: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeRow(idx)}
                    disabled={rows.length <= 1}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {selected && (
            <div
              className={`flex justify-between rounded-md border p-2 text-sm ${
                sumValid
                  ? "border-green-500/30 bg-green-500/5 text-green-600 dark:text-green-400"
                  : "border-destructive/30 bg-destructive/5 text-destructive"
              }`}
            >
              <span>Sum of installments</span>
              <span className="font-mono font-semibold">
                Rs {sum.toLocaleString("en-IN")} / Rs{" "}
                {targetAmount.toLocaleString("en-IN")}
              </span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !selected || !sumValid}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? "Creating..." : "Create Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
