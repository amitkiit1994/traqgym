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
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { returnKeyAction } from "@/lib/actions/locker-key";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issuanceId: number;
  depositAmount: number;
  onSuccess?: () => void;
};

export function ReturnKeyDialog({
  open,
  onOpenChange,
  issuanceId,
  depositAmount,
  onSuccess,
}: Props) {
  const [conditionNotes, setConditionNotes] = useState("");
  const [refundDeposit, setRefundDeposit] = useState(true);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = () => {
    setError("");
    startTransition(async () => {
      const result = await returnKeyAction({
        issuanceId,
        conditionNotes: conditionNotes || undefined,
        refundDeposit,
      });
      if (result.success) {
        onOpenChange(false);
        setConditionNotes("");
        setRefundDeposit(true);
        onSuccess?.();
      } else {
        setError(result.error || "Failed to return key");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Return Locker Key</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="ret-condition">Condition Notes (optional)</Label>
            <Input
              id="ret-condition"
              value={conditionNotes}
              onChange={(e) => setConditionNotes(e.target.value)}
              placeholder="Key returned in good condition"
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label>Refund deposit</Label>
              <p className="text-xs text-muted-foreground">
                ₹{depositAmount.toLocaleString("en-IN")} will be marked refunded
              </p>
            </div>
            <Switch checked={refundDeposit} onCheckedChange={setRefundDeposit} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Return Key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
