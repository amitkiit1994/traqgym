"use client";

import { useEffect, useState, useTransition } from "react";
import {
  createDietPlanAction,
  getDietPlansAction,
  assignDietPlanAction,
} from "@/lib/actions/diet";
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

type Meal = {
  mealType: string;
  description: string;
  calories: number | null;
};

type DietPlan = {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string | Date;
  createdBy: { firstname: string; lastname: string } | null;
  _count: { meals: number };
};

const MEAL_TYPES = ["breakfast", "morning_snack", "lunch", "evening_snack", "dinner", "pre_workout", "post_workout"];

export default function DietPage() {
  const [plans, setPlans] = useState<DietPlan[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignPlanId, setAssignPlanId] = useState<number | null>(null);
  const [meals, setMeals] = useState<Meal[]>([
    { mealType: "breakfast", description: "", calories: null },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getDietPlansAction();
      setPlans(data as DietPlan[]);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setMeals([{ mealType: "breakfast", description: "", calories: null }]);
    setErrors({});
    setCreateOpen(true);
  };

  const addMeal = () => {
    setMeals([...meals, { mealType: "lunch", description: "", calories: null }]);
  };

  const removeMeal = (i: number) => {
    setMeals(meals.filter((_, idx) => idx !== i));
  };

  const updateMeal = (i: number, field: keyof Meal, value: string | number | null) => {
    const updated = [...meals];
    (updated[i] as Record<string, unknown>)[field] = value;
    setMeals(updated);
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

    const validMeals = meals.filter((m) => m.description.trim());
    if (validMeals.length === 0) {
      setErrors({ meals: "Add at least one meal" });
      return;
    }

    startTransition(async () => {
      const result = await createDietPlanAction({
        name,
        description,
        meals: validMeals.map((m) => ({
          mealType: m.mealType,
          description: m.description.trim(),
          calories: m.calories ?? undefined,
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
      const result = await assignDietPlanAction(userId, assignPlanId);
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Diet Plans</h1>
        <Button onClick={openCreate}>Create Plan</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Meals</TableHead>
            <TableHead>Created By</TableHead>
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
                <Badge variant="outline">{p._count.meals} meals</Badge>
              </TableCell>
              <TableCell>
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
                No diet plans found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Create Plan Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Diet Plan</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label htmlFor="name">Plan Name</Label>
              <Input id="name" name="name" key="new-diet-name" />
              {errors.name && (
                <p className="text-xs text-destructive mt-1">{errors.name}</p>
              )}
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input id="description" name="description" key="new-diet-desc" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Meals</Label>
                <Button type="button" variant="outline" size="sm" onClick={addMeal}>
                  + Add Meal
                </Button>
              </div>
              {errors.meals && (
                <p className="text-xs text-destructive">{errors.meals}</p>
              )}
              {meals.map((meal, i) => (
                <div key={i} className="grid grid-cols-4 gap-2 items-end border rounded-md p-2">
                  <div>
                    <Label className="text-xs">Type</Label>
                    <select
                      value={meal.mealType}
                      onChange={(e) => updateMeal(i, "mealType", e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-1 py-1 text-xs"
                    >
                      {MEAL_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Description</Label>
                    <Input
                      value={meal.description}
                      onChange={(e) => updateMeal(i, "description", e.target.value)}
                      placeholder="Meal description"
                    />
                  </div>
                  <div className="flex gap-1 items-end">
                    <div className="flex-1">
                      <Label className="text-xs">Cal</Label>
                      <Input
                        type="number"
                        value={meal.calories ?? ""}
                        onChange={(e) =>
                          updateMeal(
                            i,
                            "calories",
                            e.target.value ? parseInt(e.target.value, 10) : null
                          )
                        }
                        placeholder="kcal"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => removeMeal(i)}
                      disabled={meals.length === 1}
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
            <DialogTitle>Assign Diet Plan</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAssign} className="space-y-3">
            <div>
              <Label htmlFor="userId">Member ID</Label>
              <Input
                id="userId"
                name="userId"
                type="number"
                key={`assign-diet-${assignPlanId ?? "none"}`}
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
