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
  DialogFooter,
} from "@/components/ui/dialog";

type Status = "scheduled" | "completed" | "no_show" | "cancelled";

function nowLocalDateTimeString() {
  const d = new Date();
  // YYYY-MM-DDTHH:MM (datetime-local input expects local time, no tz suffix)
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RecordPtSessionDialog({
  open,
  onOpenChange,
  packageId,
  defaultStatus,
  onRecorded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  packageId: number | null;
  defaultStatus?: Status;
  onRecorded?: () => void;
}) {
  const [scheduledAt, setScheduledAt] = useState<string>(nowLocalDateTimeString());
  const [status, setStatus] = useState<Status>(defaultStatus ?? "completed");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setScheduledAt(nowLocalDateTimeString());
      setStatus(defaultStatus ?? "completed");
      setNotes("");
      setError("");
    }
  }, [open, defaultStatus]);

  const handleSubmit = () => {
    setError("");
    if (!packageId) {
      setError("No package selected");
      return;
    }
    if (!scheduledAt) {
      setError("Pick a date/time");
      return;
    }
    startTransition(async () => {
      const { recordPtSessionAction } = await import("@/lib/actions/pt");
      const result = await recordPtSessionAction({
        packageId,
        scheduledAt: new Date(scheduledAt).toISOString(),
        status,
        notes: notes || undefined,
      });
      if (result.success) {
        onOpenChange(false);
        onRecorded?.();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record PT Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Date & time</Label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Status</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
              className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="completed">Completed</option>
              <option value="scheduled">Scheduled</option>
              <option value="no_show">No-show</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <Label>Notes</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
              placeholder="Optional notes..."
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending || !packageId}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
