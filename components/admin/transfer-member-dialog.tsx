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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { transferMember } from "@/lib/actions/members";

type LocationOption = { id: number; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: number;
  ticketId: number;
  ticketExpireDate: string; // ISO
  fromLocationName?: string;
  locations: LocationOption[];
  onSuccess?: () => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function TransferMemberDialog({
  open,
  onOpenChange,
  userId,
  ticketId,
  ticketExpireDate,
  fromLocationName,
  locations,
  onSuccess,
}: Props) {
  const [toLocationId, setToLocationId] = useState("");
  const [carryOver, setCarryOver] = useState(true);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  const daysRemaining = Math.max(
    0,
    Math.ceil((new Date(ticketExpireDate).getTime() - Date.now()) / DAY_MS)
  );

  const handleSubmit = () => {
    const dest = parseInt(toLocationId, 10);
    if (!dest) {
      setError("Select a destination location");
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await transferMember({
        userId,
        toLocationId: dest,
        ticketId,
        carryOverDays: carryOver,
      });
      if (result.success) {
        onOpenChange(false);
        setToLocationId("");
        onSuccess?.();
      } else {
        setError(result.error || "Failed to transfer member");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer Member</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {fromLocationName && (
            <p className="text-xs text-muted-foreground">
              From: <span className="font-medium text-foreground">{fromLocationName}</span>
            </p>
          )}
          <div>
            <Label>Destination Location</Label>
            <Select value={toLocationId} onValueChange={(v) => setToLocationId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Select location">
                  {toLocationId
                    ? locations.find((l) => String(l.id) === toLocationId)?.name ?? ""
                    : "Select location"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label>Carry over remaining days</Label>
              <p className="text-xs text-muted-foreground">
                {daysRemaining} day{daysRemaining === 1 ? "" : "s"} remaining on current plan
              </p>
            </div>
            <Switch checked={carryOver} onCheckedChange={setCarryOver} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={isPending || !toLocationId}>
            {isPending && <Loader2 className="size-4 animate-spin" />}
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
