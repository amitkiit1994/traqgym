"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
      <Button onClick={() => setIssueOpen(true)}>Issue Comp</Button>
      <Button variant="outline" onClick={() => setIssuePassOpen(true)}>
        Issue Comp Pass
      </Button>
      <IssueCompDialog open={issueOpen} onOpenChange={setIssueOpen} />
      <IssueCompPassDialog
        open={issuePassOpen}
        onOpenChange={setIssuePassOpen}
      />
    </div>
  );
}

export function RevokeCompButton({ ticketId }: { ticketId: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    if (typeof window !== "undefined") {
      const reason = window.prompt("Reason for revoking this comp?");
      if (!reason) return;
      startTransition(async () => {
        const res = await revokeCompAction({ ticketId, reason });
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
