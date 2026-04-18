"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { recordMovementAction } from "@/lib/actions/cash-shift";
import type { ShiftMovementType } from "@/lib/services/cash-shift";

const TYPES: Array<{ value: ShiftMovementType; label: string }> = [
  { value: "float_topup", label: "Float top-up" },
  { value: "cash_withdrawal", label: "Cash withdrawal" },
  { value: "expense", label: "Petty expense" },
  { value: "deposit_to_bank", label: "Deposit to bank" },
];

export function RecordMovementDialog({
  open,
  onOpenChange,
  shiftId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  shiftId: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<ShiftMovementType>("float_topup");
  const [amount, setAmount] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Amount must be > 0");
      return;
    }
    if (!reason.trim()) {
      setError("Reason is required");
      return;
    }
    startTransition(async () => {
      const res = await recordMovementAction({
        shiftId,
        type,
        amount: amt,
        reason: reason.trim(),
      });
      if (res.success) {
        onOpenChange(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record cash movement</DialogTitle>
          <DialogDescription>
            Log float top-ups, withdrawals, petty expenses, or bank deposits
            within this shift.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Movement type</Label>
            <Select
              value={type}
              onValueChange={(v) =>
                setType((v ?? "float_topup") as ShiftMovementType)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="movement-amount">Amount (INR)</Label>
            <Input
              id="movement-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="movement-reason">Reason</Label>
            <Textarea
              id="movement-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What this movement is for..."
              className="min-h-[60px]"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Saving..." : "Record movement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
