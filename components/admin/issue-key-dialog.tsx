"use client";

import { useState, useTransition } from "react";
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
import { Loader2 } from "lucide-react";
import { issueKeyAction } from "@/lib/actions/locker-key";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lockerId: number;
  userId: number;
  defaultDeposit?: number;
  onSuccess?: () => void;
};

export function IssueKeyDialog({
  open,
  onOpenChange,
  lockerId,
  userId,
  defaultDeposit = 500,
  onSuccess,
}: Props) {
  const [deposit, setDeposit] = useState(String(defaultDeposit));
  const [expectedReturn, setExpectedReturn] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = () => {
    const depositAmount = Number(deposit);
    if (!Number.isFinite(depositAmount) || depositAmount < 0) {
      setError("Deposit must be a non-negative number");
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await issueKeyAction({
        lockerId,
        userId,
        depositAmount,
        expectedReturnAt: expectedReturn || null,
        conditionNotes: conditionNotes || undefined,
      });
      if (result.success) {
        onOpenChange(false);
        setDeposit(String(defaultDeposit));
        setExpectedReturn("");
        setConditionNotes("");
        onSuccess?.();
      } else {
        setError(result.error || "Failed to issue key");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Issue Locker Key</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="key-deposit">Deposit Amount (₹)</Label>
            <Input
              id="key-deposit"
              type="number"
              min="0"
              step="0.01"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="key-expected">Expected Return Date</Label>
            <Input
              id="key-expected"
              type="date"
              value={expectedReturn}
              onChange={(e) => setExpectedReturn(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="key-condition">Condition Notes (optional)</Label>
            <Input
              id="key-condition"
              value={conditionNotes}
              onChange={(e) => setConditionNotes(e.target.value)}
              placeholder="Key has minor scratch..."
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Issue Key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
