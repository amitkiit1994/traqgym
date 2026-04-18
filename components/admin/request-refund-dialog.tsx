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
import { requestRefundAction } from "@/lib/actions/refund";
import type { RefundReason, RefundMode } from "@/lib/services/refund";

const REASONS: Array<{ value: RefundReason; label: string }> = [
  { value: "quit", label: "Quit / cancelling membership" },
  { value: "dissatisfied", label: "Dissatisfied" },
  { value: "duplicate_charge", label: "Duplicate charge" },
  { value: "medical", label: "Medical reason" },
  { value: "gym_closure", label: "Gym closure / move" },
  { value: "other", label: "Other" },
];

const MODES: Array<{ value: RefundMode; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "adjust_against_next_plan", label: "Adjust against next plan" },
];

export function RequestRefundDialog({
  open,
  onOpenChange,
  paymentId,
  maxAmount,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  paymentId: number;
  maxAmount?: number;
  onSuccess?: (refundId: number, approvalId: number) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [amount, setAmount] = useState<string>(
    maxAmount != null ? String(maxAmount) : ""
  );
  const [reason, setReason] = useState<RefundReason>("dissatisfied");
  const [reasonDetail, setReasonDetail] = useState("");
  const [mode, setMode] = useState<RefundMode>("cash");
  const [proRataDays, setProRataDays] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    setError(null);
    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError("Enter a valid refund amount > 0");
      return;
    }
    if (maxAmount != null && amountNum > maxAmount) {
      setError(`Refund amount cannot exceed ₹${maxAmount}`);
      return;
    }
    const proRataNum = proRataDays ? parseInt(proRataDays, 10) : undefined;
    if (proRataDays && (!Number.isFinite(proRataNum) || (proRataNum ?? 0) < 0)) {
      setError("Pro-rata days must be a non-negative integer");
      return;
    }

    startTransition(async () => {
      const res = await requestRefundAction({
        paymentId,
        amountRequested: amountNum,
        reason,
        reasonDetail: reasonDetail || undefined,
        refundMode: mode,
        proRataDays: proRataNum,
        notes: notes || undefined,
      });
      if (res.success && res.data) {
        onSuccess?.(res.data.refundId, res.data.approvalId);
        onOpenChange(false);
        router.refresh();
      } else if (!res.success) {
        setError(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request refund</DialogTitle>
          <DialogDescription>
            Refunds require admin approval before they can be processed.
            {maxAmount != null && ` Max refundable: ₹${maxAmount}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="refund-amount">Amount (INR)</Label>
            <Input
              id="refund-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div>
            <Label>Reason</Label>
            <Select
              value={reason}
              onValueChange={(v) => setReason((v ?? "other") as RefundReason)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="refund-reason-detail">
              Reason detail (optional)
            </Label>
            <Textarea
              id="refund-reason-detail"
              value={reasonDetail}
              onChange={(e) => setReasonDetail(e.target.value)}
              placeholder="Add context for the approver..."
              className="min-h-[60px]"
            />
          </div>

          <div>
            <Label>Refund mode</Label>
            <Select
              value={mode}
              onValueChange={(v) => setMode((v ?? "cash") as RefundMode)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="refund-prorata">
              Pro-rata days (optional)
            </Label>
            <Input
              id="refund-prorata"
              type="number"
              min="0"
              step="1"
              value={proRataDays}
              onChange={(e) => setProRataDays(e.target.value)}
              placeholder="Used days for partial refund calc"
            />
          </div>

          <div>
            <Label htmlFor="refund-notes">Notes (optional)</Label>
            <Textarea
              id="refund-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Requesting..." : "Request refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
