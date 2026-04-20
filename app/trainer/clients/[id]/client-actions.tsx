"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CheckCircle2, Loader2 } from "lucide-react";
import { completePtSessionAction } from "@/lib/actions/pt";

export function CompleteSessionButton({
  sessionId,
  disabled,
}: {
  sessionId: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await completePtSessionAction(
        sessionId,
        notes.trim() || undefined
      );
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setNotes("");
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          setOpen(next);
          if (!next) setError(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            className="gap-1"
          />
        }
      >
        <CheckCircle2 className="size-3.5" />
        Mark complete
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Complete session</DialogTitle>
          <DialogDescription>
            Add an optional note about what you covered. This will deduct one
            session from the package.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What did you cover today? (optional)"
          rows={4}
          maxLength={1000}
          disabled={pending}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={pending} className="gap-1">
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            Confirm complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
