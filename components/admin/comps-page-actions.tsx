"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IssueCompDialog } from "./issue-comp-dialog";
import { IssueCompPassDialog } from "./issue-comp-pass-dialog";
import {
  revokeCompAction,
  revokeCompPassAction,
} from "@/lib/actions/comp";

export function CompsPageActions() {
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuePassOpen, setIssuePassOpen] = useState(false);

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() => setIssueOpen(true)}
        title="Give a member a real plan (e.g. 1-Month Gold) at ₹0. Counts in active members."
      >
        Issue Free Plan
      </Button>
      <Button
        variant="outline"
        onClick={() => setIssuePassOpen(true)}
        title="Informal day pass — no plan, just access for N days. Doesn't count as an active member on a plan."
      >
        Issue Day Pass
      </Button>
      <IssueCompDialog open={issueOpen} onOpenChange={setIssueOpen} />
      <IssueCompPassDialog
        open={issuePassOpen}
        onOpenChange={setIssuePassOpen}
      />
    </div>
  );
}

export function RevokeCompButton({
  ticketId,
  memberName,
  daysRemaining,
  reason,
}: {
  ticketId: number;
  memberName: string;
  daysRemaining: number | null;
  reason: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");

  const onConfirm = () => {
    if (!revokeReason.trim()) {
      setError("Reason is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await revokeCompAction({
        ticketId,
        reason: revokeReason.trim(),
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setRevokeReason("");
      router.refresh();
    });
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setError(null);
      setRevokeReason("");
    }
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="xs"
        onClick={() => setOpen(true)}
        disabled={isPending}
        aria-label={`Revoke comp for ${memberName}`}
      >
        {isPending ? "Revoking…" : "Revoke"}
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke complimentary membership?</DialogTitle>
            <DialogDescription>
              This will end the comp immediately. Provide a reason for the
              audit log.
            </DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Member</dt>
            <dd className="font-medium">{memberName}</dd>
            <dt className="text-muted-foreground">Days remaining</dt>
            <dd>{daysRemaining === null ? "Unknown" : daysRemaining}</dd>
            <dt className="text-muted-foreground">Original reason</dt>
            <dd>{reason ?? "—"}</dd>
          </dl>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              Reason for revoking <span className="text-destructive">*</span>
            </span>
            <input
              type="text"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              disabled={isPending}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="e.g. Issued in error"
              autoFocus
            />
          </label>
          {error && (
            <span className="text-xs text-destructive" role="alert">
              {error}
            </span>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? "Revoking…" : "Revoke"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RevokeCompPassButton({ passId }: { passId: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    if (typeof window !== "undefined") {
      const reason = window.prompt("Reason for revoking this comp pass?");
      if (!reason) return;
      startTransition(async () => {
        const res = await revokeCompPassAction({ passId, reason });
        if (!res.success) {
          setError(res.error);
          return;
        }
        router.refresh();
      });
    }
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="xs"
        onClick={onClick}
        disabled={isPending}
      >
        {isPending ? "Revoking…" : "Revoke"}
      </Button>
      {error && (
        <span className="text-[10px] text-destructive" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
