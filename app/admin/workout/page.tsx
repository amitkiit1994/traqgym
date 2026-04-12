"use client";

import { useEffect, useState, useTransition } from "react";
import {
  createWorkoutPlanAction,
  getWorkoutPlansAction,
  assignWorkoutPlanAction,
} from "@/lib/actions/workout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type Exercise = {
  name: string;
  sets: number;
  reps: number;
  weight: number | null;
  day: string;
};

type WorkoutPlan = {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string | Date;
  createdBy: { firstname: string; lastname: string } | null;
  _count: { exercises: number };
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function WorkoutPage() {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignPlanId, setAssignPlanId] = useState<number | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([
    { name: "", sets: 3, reps: 12, weight: null, day: "Monday" },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getWorkoutPlansAction();
      setPlans(data as WorkoutPlan[]);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setExercises([{ name: "", sets: 3, reps: 12, weight: null, day: "Monday" }]);
    setErrors({});
    setCreateOpen(true);
  };

  const addExercise = () => {
    setExercises([
      ...exercises,
      { name: "", sets: 3, reps: 12, weight: null, day: "Monday" },
    ]);
  };

  const removeExercise = (i: number) => {
    setExercises(exercises.filter((_, idx) => idx !== i));
  };

  const updateExercise = (i: number, field: keyof Exercise, value: string | number | null) => {
    const updated = [...exercises];
    (updated[i] as Record<string, unknown>)[field] = value;
    setExercises(updated);
  };

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = (fd.get("name") as string).trim();
    const description = (fd.get("description") as string).trim() || undefined;

    if (!name) {
      setErrors({ name: "Plan name is required" });
      return;
    }

    const validExercises = exercises.filter((ex) => ex.name.trim());
    if (validExercises.length === 0) {
      setErrors({ exercises: "Add at least one exercise" });
      return;
    }

    startTransition(async () => {
      const result = await createWorkoutPlanAction({
        name,
        description,
        exercises: validExercises.map((ex) => ({
          name: ex.name.trim(),
          sets: ex.sets,
          reps: ex.reps,
          weight: ex.weight ?? undefined,
          day: ex.day,
        })),
        createdById: 1, // Admin worker ID
      });
      if ("error" in result && result.error) {
        setErrors({ form: result.error });
      } else {
        setCreateOpen(false);
        load();
      }
    });
  };

  const openAssign = (planId: number) => {
    setAssignPlanId(planId);
    setErrors({});
    setAssignOpen(true);
  };

  const handleAssign = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!assignPlanId) return;
    const fd = new FormData(e.currentTarget);
    const userId = parseInt(fd.get("userId") as string, 10);

    if (!userId) {
      setErrors({ userId: "Enter a valid member ID" });
      return;
    }

    startTransition(async () => {
      const result = await assignWorkoutPlanAction(userId, assignPlanId);
      if ("error" in result && result.error) {
        setErrors({ form: result.error });
      } else {
        setAssignOpen(false);
        load();
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Workout Plans</h1>
        <Button onClick={openCreate}>Create Plan</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Exercises</TableHead>
            <TableHead className="hidden md:table-cell">Created By</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plans.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">
                {p.name}
                {p.description && (
                  <span className="block text-xs text-muted-foreground">
                    {p.description}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="outline">{p._count.exercises} exercises</Badge>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {p.createdBy
                  ? `${p.createdBy.firstname} ${p.createdBy.lastname}`
                  : "-"}
              </TableCell>
              <TableCell>
                <Badge
                  className={
                    p.isActive
                      ? "bg-status-active-bg text-status-active-foreground border-status-active/30"
                      : "bg-status-expired-bg text-status-expired-foreground border-status-expired/30"
                  }
                >
                  {p.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openAssign(p.id)}
                >
                  Assign
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {plans.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No workout plans found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Create Plan Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Workout Plan</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label htmlFor="name">Plan Name</Label>
              <Input id="name" name="name" key="new-plan-name" />
              {errors.name && (
                <p className="text-xs text-destructive mt-1">{errors.name}</p>
              )}
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input id="description" name="description" key="new-plan-desc" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Exercises</Label>
                <Button type="button" variant="outline" size="sm" onClick={addExercise}>
                  + Add Exercise
                </Button>
              </div>
              {errors.exercises && (
                <p className="text-xs text-destructive">{errors.exercises}</p>
              )}
              {exercises.map((ex, i) => (
                <div key={i} className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end border rounded-md p-2">
                  <div className="col-span-2">
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={ex.name}
                      onChange={(e) => updateExercise(i, "name", e.target.value)}
                      placeholder="Exercise name"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Sets</Label>
                    <Input
                      type="number"
                      value={ex.sets}
                      onChange={(e) => updateExercise(i, "sets", parseInt(e.target.value, 10) || 3)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Reps</Label>
                    <Input
                      type="number"
                      value={ex.reps}
                      onChange={(e) => updateExercise(i, "reps", parseInt(e.target.value, 10) || 12)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Day</Label>
                    <select
                      value={ex.day}
                      onChange={(e) => updateExercise(i, "day", e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-1 py-1 text-xs"
                    >
                      {DAYS.map((d) => (
                        <option key={d} value={d}>
                          {d.slice(0, 3)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeExercise(i)}
                      disabled={exercises.length === 1}
                    >
                      X
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {errors.form && (
              <p className="text-xs text-destructive">{errors.form}</p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Assign Dialog */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Workout Plan</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAssign} className="space-y-3">
            <div>
              <Label htmlFor="userId">Member ID</Label>
              <Input
                id="userId"
                name="userId"
                type="number"
                key={`assign-${assignPlanId ?? "none"}`}
              />
              {errors.userId && (
                <p className="text-xs text-destructive mt-1">{errors.userId}</p>
              )}
            </div>
            {errors.form && (
              <p className="text-xs text-destructive">{errors.form}</p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                Assign
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
