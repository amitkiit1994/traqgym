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
import { closeShiftAction } from "@/lib/actions/cash-shift";

export function CloseShiftDialog({
  open,
  onOpenChange,
  shiftId,
  locationName,
  openingFloat,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  shiftId: number;
  locationName?: string;
  openingFloat?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [closingCounted, setClosingCounted] = useState<string>("");
  const [varianceReason, setVarianceReason] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    setResultMsg(null);
    const counted = parseFloat(closingCounted);
    if (!Number.isFinite(counted) || counted < 0) {
      setError("Closing counted must be a non-negative number");
      return;
    }
    startTransition(async () => {
      const res = await closeShiftAction({
        shiftId,
        closingCounted: counted,
        varianceReason: varianceReason || undefined,
        notes: notes || undefined,
      });
      if (res.success && res.data) {
        const v = res.data.variance;
        if (res.data.requiresApproval) {
          setResultMsg(
            `Shift closed pending admin approval — variance ₹${v.toFixed(2)} exceeds threshold. Approval #${res.data.approvalId ?? "?"}`
          );
        } else {
          setResultMsg(
            `Shift closed. Expected ₹${res.data.closingExpected.toFixed(2)}, counted ₹${counted.toFixed(2)}, variance ₹${v.toFixed(2)}.`
          );
          onOpenChange(false);
        }
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
          <DialogTitle>Close cash shift</DialogTitle>
          <DialogDescription>
            Count the cash in the drawer and enter the total below. The system
            will compute expected cash and any variance.
            {locationName && ` Location: ${locationName}.`}
            {openingFloat != null && ` Opening float: ₹${openingFloat}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="closing-counted">Counted cash (INR)</Label>
            <Input
              id="closing-counted"
              type="number"
              min="0"
              step="0.01"
              value={closingCounted}
              onChange={(e) => setClosingCounted(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div>
            <Label htmlFor="variance-reason">
              Variance reason (if there's a discrepancy)
            </Label>
            <Textarea
              id="variance-reason"
              value={varianceReason}
              onChange={(e) => setVarianceReason(e.target.value)}
              placeholder="e.g. ₹50 short — possibly miscounted change"
              className="min-h-[60px]"
            />
          </div>
          <div>
            <Label htmlFor="close-notes">Notes (optional)</Label>
            <Textarea
              id="close-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[60px]"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {resultMsg && (
            <p className="text-sm text-muted-foreground">{resultMsg}</p>
          )}
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
            {isPending ? "Closing..." : "Close shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
