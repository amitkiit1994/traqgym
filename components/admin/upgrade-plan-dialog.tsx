"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  upgradePlanAction,
  previewUpgradeAction,
  getActivePlansForUpgrade,
} from "@/lib/actions/upgrade";
import { Loader2, ArrowUpCircle } from "lucide-react";

type Plan = {
  id: number;
  name: string;
  price: number;
  expireDays: number;
};

type Preview =
  | { ok: true; creditApplied: number; newPlanPrice: number; suggestedAmountDue: number; newExpiryDate: Date | string; oldPlanName: string; newPlanName: string }
  | { ok: false; error: string }
  | null;

const PAYMENT_MODES = ["cash", "upi", "card", "cheque", "bank_transfer", "other"] as const;
const PRORATION_MODES = ["daily", "monthly", "none"] as const;

export type UpgradePlanDialogProps = {
  memberTicketId: number;
  currentPlanId?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (result: { newTicketId: number; creditApplied: number; invoiceNumber: string }) => void;
};

export function UpgradePlanDialog({
  memberTicketId,
  currentPlanId,
  open,
  onOpenChange,
  onSuccess,
}: UpgradePlanDialogProps) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [newPlanId, setNewPlanId] = useState<string>("");
  const [paymentMode, setPaymentMode] = useState<string>("cash");
  const [prorationMode, setProrationMode] =
    useState<(typeof PRORATION_MODES)[number]>("daily");
  const [paidAmount, setPaidAmount] = useState<string>("");
  const [upiReference, setUpiReference] = useState<string>("");
  const [preview, setPreview] = useState<Preview>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingPlans, startLoadingPlans] = useTransition();
  const [isPreviewing, startPreview] = useTransition();
  const [isSubmitting, startSubmit] = useTransition();

  // Load plans whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    setError(null);
    setPreview(null);
    setNewPlanId("");
    setPaidAmount("");
    setUpiReference("");
    startLoadingPlans(async () => {
      const data = await getActivePlansForUpgrade();
      // Hide the current plan from the dropdown
      setPlans(data.filter((p) => p.id !== currentPlanId));
    });
  }, [open, currentPlanId]);

  // Refresh preview when plan or proration mode changes
  useEffect(() => {
    if (!open || !newPlanId) {
      setPreview(null);
      return;
    }
    const planIdNum = parseInt(newPlanId, 10);
    if (!Number.isFinite(planIdNum) || planIdNum <= 0) return;
    startPreview(async () => {
      const result = await previewUpgradeAction({
        memberTicketId,
        newPlanId: planIdNum,
        prorationMode,
      });
      setPreview(result);
      if (result && result.ok) {
        // Pre-fill paidAmount with suggested amount due
        setPaidAmount(String(result.suggestedAmountDue));
      }
    });
  }, [open, newPlanId, prorationMode, memberTicketId]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const planIdNum = parseInt(newPlanId, 10);
    const amountNum = parseFloat(paidAmount);

    if (!planIdNum || planIdNum <= 0) {
      setError("Please select a new plan");
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      setError("Please enter a valid amount");
      return;
    }

    startSubmit(async () => {
      const result = await upgradePlanAction({
        memberTicketId,
        newPlanId: planIdNum,
        paidAmount: amountNum,
        paymentMode,
        prorationMode,
        upiReference: paymentMode === "upi" ? upiReference || undefined : undefined,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      onSuccess?.({
        newTicketId: result.newTicketId,
        creditApplied: result.creditApplied,
        invoiceNumber: result.invoiceNumber,
      });
      onOpenChange(false);
    });
  };

  const previewOk = preview && preview.ok ? preview : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUpCircle className="size-4" />
            Upgrade plan
          </DialogTitle>
          <DialogDescription>
            Upgrade this member to a new plan mid-cycle. A pro-rata credit from
            the current plan will be applied to the new plan price.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-plan">New plan</Label>
            <Select
              value={newPlanId}
              onValueChange={(v) => setNewPlanId(v ?? "")}
            >
              <SelectTrigger id="new-plan" className="w-full">
                <SelectValue placeholder={isLoadingPlans ? "Loading..." : "Select a plan"} />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name} — ₹{p.price.toLocaleString("en-IN")} ({p.expireDays}d)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="proration-mode">Proration mode</Label>
            <Select
              value={prorationMode}
              onValueChange={(v) =>
                setProrationMode((v as (typeof PRORATION_MODES)[number]) ?? "daily")
              }
            >
              <SelectTrigger id="proration-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRORATION_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    <span className="capitalize">{m}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {previewOk && (
            <div className="rounded-md border border-border/40 bg-muted/30 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current plan</span>
                <span>{previewOk.oldPlanName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">New plan</span>
                <span>
                  {previewOk.newPlanName} — ₹
                  {previewOk.newPlanPrice.toLocaleString("en-IN")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Credit applied</span>
                <span className="text-emerald-600 dark:text-emerald-400">
                  −₹{previewOk.creditApplied.toLocaleString("en-IN")}
                </span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Suggested amount due</span>
                <span>₹{previewOk.suggestedAmountDue.toLocaleString("en-IN")}</span>
              </div>
            </div>
          )}
          {preview && !preview.ok && (
            <p className="text-xs text-destructive">{preview.error}</p>
          )}
          {isPreviewing && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="size-3 animate-spin" /> Calculating preview…
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="paid-amount">Amount collected (₹)</Label>
            <Input
              id="paid-amount"
              type="number"
              min="0"
              step="0.01"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
              placeholder="0"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="payment-mode">Payment mode</Label>
            <Select
              value={paymentMode}
              onValueChange={(v) => setPaymentMode(v ?? "cash")}
            >
              <SelectTrigger id="payment-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    <span className="capitalize">{m.replace("_", " ")}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {paymentMode === "upi" && (
            <div className="space-y-1.5">
              <Label htmlFor="upi-ref">UPI reference (optional)</Label>
              <Input
                id="upi-ref"
                value={upiReference}
                onChange={(e) => setUpiReference(e.target.value)}
                placeholder="UPI txn id"
              />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !newPlanId}>
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Confirm upgrade
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Convenience wrapper: a button that opens the dialog. */
export function UpgradePlanButton({
  memberTicketId,
  currentPlanId,
  label = "Upgrade plan",
  variant = "outline",
  size = "sm",
  className,
  onSuccess,
}: {
  memberTicketId: number;
  currentPlanId?: number;
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  onSuccess?: UpgradePlanDialogProps["onSuccess"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        <ArrowUpCircle className="size-4" />
        {label}
      </Button>
      <UpgradePlanDialog
        memberTicketId={memberTicketId}
        currentPlanId={currentPlanId}
        open={open}
        onOpenChange={setOpen}
        onSuccess={onSuccess}
      />
    </>
  );
}
