"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { openShiftAction } from "@/lib/actions/cash-shift";

export type LocationOption = { id: number; name: string };

export function OpenShiftDialog({
  open,
  onOpenChange,
  locations,
  defaultLocationId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locations: LocationOption[];
  defaultLocationId?: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [locationId, setLocationId] = useState<string>(
    defaultLocationId
      ? String(defaultLocationId)
      : locations[0]
        ? String(locations[0].id)
        : ""
  );
  const [openingFloat, setOpeningFloat] = useState<string>("0");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const locId = parseInt(locationId, 10);
    const floatNum = parseFloat(openingFloat);
    if (!Number.isFinite(locId) || locId <= 0) {
      setError("Please choose a location");
      return;
    }
    if (!Number.isFinite(floatNum) || floatNum < 0) {
      setError("Opening float must be >= 0");
      return;
    }
    startTransition(async () => {
      const res = await openShiftAction({
        locationId: locId,
        openingFloat: floatNum,
      });
      if (res.success) {
        onOpenChange(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open cash shift</DialogTitle>
          <DialogDescription>
            Start a new drawer session at a location with the cash currently in
            hand.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Location</Label>
            <Select
              value={locationId}
              onValueChange={(v) => setLocationId(v ?? "")}
            >
              <SelectTrigger className="w-full">
                {/*
                 * Bug #4 fix — Base UI's <Select.Value> renders the raw item
                 * `value` (the FK id, e.g. "292") by default. Use the render
                 * prop to map the selected id back to the location name so
                 * users see "Mumbai HQ" instead of "292".
                 */}
                <SelectValue placeholder="Select location">
                  {(value: string) =>
                    locations.find((l) => String(l.id) === value)?.name ??
                    "Select location"
                  }
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
          <div>
            <Label htmlFor="opening-float">Opening float (INR)</Label>
            <Input
              id="opening-float"
              type="number"
              min="0"
              step="0.01"
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Opening..." : "Open shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
