"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Undo2 } from "lucide-react";
import { RequestRefundDialog } from "./request-refund-dialog";

/**
 * Drop-in trigger for the refund request flow. Mount from any page that has a
 * paymentId in scope. Example:
 *
 *   <RefundTriggerButton paymentId={p.id} maxAmount={Number(p.amount)} />
 */
export function RefundTriggerButton({
  paymentId,
  maxAmount,
  variant = "outline",
  size = "sm",
  label = "Request refund",
  showIcon = true,
}: {
  paymentId: number;
  maxAmount?: number;
  variant?: "outline" | "default" | "ghost" | "secondary";
  size?: "sm" | "default" | "lg";
  label?: string;
  showIcon?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
      >
        {showIcon && <Undo2 className="size-3.5" />}
        {label}
      </Button>
      <RequestRefundDialog
        open={open}
        onOpenChange={setOpen}
        paymentId={paymentId}
        maxAmount={maxAmount}
      />
    </>
  );
}
