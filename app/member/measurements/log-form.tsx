"use client";

import { useState, useTransition } from "react";
import { addMeasurement } from "@/lib/actions/measurements";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function LogMeasurementForm({ userId }: { userId: number }) {
  const [form, setForm] = useState({
    date: new Date().toISOString().split("T")[0],
    weight: "",
    height: "",
    chest: "",
    waist: "",
    hips: "",
    biceps: "",
    notes: "",
  });
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const weight = form.weight ? parseFloat(form.weight) : undefined;
    const height = form.height ? parseFloat(form.height) : undefined;
    const chest = form.chest ? parseFloat(form.chest) : undefined;
    const waist = form.waist ? parseFloat(form.waist) : undefined;
    const hips = form.hips ? parseFloat(form.hips) : undefined;
    const biceps = form.biceps ? parseFloat(form.biceps) : undefined;

    if (!weight && !height && !chest && !waist && !hips && !biceps) {
      toast.error("Enter at least one measurement");
      return;
    }

    startTransition(async () => {
      const result = await addMeasurement(userId, {
        date: new Date(form.date).toISOString(),
        weight,
        height,
        chest,
        waist,
        hips,
        biceps,
        notes: form.notes.trim() || undefined,
      });

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success("Measurement logged");
        setForm({
          date: new Date().toISOString().split("T")[0],
          weight: "",
          height: "",
          chest: "",
          waist: "",
          hips: "",
          biceps: "",
          notes: "",
        });
        router.refresh();
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log Measurement</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={form.date}
              onChange={(e) => update("date", e.target.value)}
              max={new Date().toISOString().split("T")[0]}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label htmlFor="weight">Weight (kg)</Label>
              <Input
                id="weight"
                type="number"
                step="0.1"
                min="0"
                placeholder="72.5"
                value={form.weight}
                onChange={(e) => update("weight", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="height">Height (cm)</Label>
              <Input
                id="height"
                type="number"
                step="0.1"
                min="0"
                placeholder="170"
                value={form.height}
                onChange={(e) => update("height", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="chest">Chest (cm)</Label>
              <Input
                id="chest"
                type="number"
                step="0.1"
                min="0"
                placeholder="95"
                value={form.chest}
                onChange={(e) => update("chest", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="waist">Waist (cm)</Label>
              <Input
                id="waist"
                type="number"
                step="0.1"
                min="0"
                placeholder="80"
                value={form.waist}
                onChange={(e) => update("waist", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="hips">Hips (cm)</Label>
              <Input
                id="hips"
                type="number"
                step="0.1"
                min="0"
                placeholder="95"
                value={form.hips}
                onChange={(e) => update("hips", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="biceps">Biceps (cm)</Label>
              <Input
                id="biceps"
                type="number"
                step="0.1"
                min="0"
                placeholder="35"
                value={form.biceps}
                onChange={(e) => update("biceps", e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Notes (optional)</Label>
            <Input
              id="notes"
              type="text"
              placeholder="e.g. after morning workout"
              value={form.notes}
              onChange={(e) => update("notes", e.target.value)}
            />
          </div>

          <Button type="submit" disabled={isPending}>
            {isPending ? "Logging..." : "Log Measurement"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
