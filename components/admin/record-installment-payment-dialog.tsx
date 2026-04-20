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
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { recordInstallmentPaymentAction } from "@/lib/actions/payment-schedule";

export type InstallmentDialogContext = {
  installmentId: number;
  memberName: string;
  sequenceNumber: number;
  expectedAmount: number;
  remaining: number;
};

export function RecordInstallmentPaymentDialog({
  context,
  onOpenChange,
  onRecorded,
}: {
  context: InstallmentDialogContext | null;
  onOpenChange: (open: boolean) => void;
  onRecorded?: () => void;
}) {
  const open = !!context;
  const [amount, setAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [upiRef, setUpiRef] = useState("");
  const [submitting, startSubmitting] = useTransition();

  useEffect(() => {
    if (context) {
      setAmount(String(context.remaining));
      setPaymentMode("cash");
      setUpiRef("");
    }
  }, [context]);

  const handleSubmit = () => {
    if (!context) return;
    const paid = parseFloat(amount);
    if (!paid || paid <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    startSubmitting(async () => {
      const result = await recordInstallmentPaymentAction({
        installmentId: context.installmentId,
        paidAmount: paid,
        paymentMode,
        upiReference: paymentMode === "upi" ? upiRef : undefined,
      });
      if (result.success) {
        toast.success(
          result.isFullyPaid
            ? "Installment cleared"
            : "Partial installment payment recorded"
        );
        onOpenChange(false);
        onRecorded?.();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Record Installment #{context?.sequenceNumber} —{" "}
            {context?.memberName}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {context && (
            <p className="text-sm text-muted-foreground">
              Installment due: Rs {context.expectedAmount.toLocaleString("en-IN")}
              {context.remaining !== context.expectedAmount && (
                <> · Remaining: Rs {context.remaining.toLocaleString("en-IN")}</>
              )}
            </p>
          )}
          <div>
            <Label>Amount</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              max={context?.remaining}
              min={1}
            />
          </div>
          <div>
            <Label>Payment Mode</Label>
            <Select
              value={paymentMode}
              onValueChange={(v) => setPaymentMode(v ?? "cash")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {paymentMode === "upi" && (
            <div>
              <Label>UPI Reference</Label>
              <Input
                value={upiRef}
                onChange={(e) => setUpiRef(e.target.value)}
                placeholder="Transaction ID"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? "Recording..." : "Record Payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
