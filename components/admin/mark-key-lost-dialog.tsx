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
import { markKeyLostAction } from "@/lib/actions/locker-key";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issuanceId: number;
  depositAmount: number;
  onSuccess?: () => void;
};

export function MarkKeyLostDialog({
  open,
  onOpenChange,
  issuanceId,
  depositAmount,
  onSuccess,
}: Props) {
  const [penalty, setPenalty] = useState("0");
  const [photoUrl, setPhotoUrl] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = () => {
    const penaltyAmount = Number(penalty);
    if (!Number.isFinite(penaltyAmount) || penaltyAmount < 0) {
      setError("Penalty must be a non-negative number");
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await markKeyLostAction({
        issuanceId,
        penaltyAmount,
        photoUrl: photoUrl || null,
      });
      if (result.success) {
        onOpenChange(false);
        setPenalty("0");
        setPhotoUrl("");
        onSuccess?.();
      } else {
        setError(result.error || "Failed to mark key lost");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark Key as Lost</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Deposit of ₹{depositAmount.toLocaleString("en-IN")} will be forfeited.
          </p>
          <div>
            <Label htmlFor="lost-penalty">Additional Penalty (₹)</Label>
            <Input
              id="lost-penalty"
              type="number"
              min="0"
              step="0.01"
              value={penalty}
              onChange={(e) => setPenalty(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lost-photo">Photo URL (optional)</Label>
            <Input
              id="lost-photo"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              placeholder="Evidence photo URL"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending} variant="destructive">
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Mark Lost
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
