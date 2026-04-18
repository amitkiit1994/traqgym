"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getPlans,
  createPlan,
  updatePlan,
  togglePlanActive,
} from "@/lib/actions/plans";
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
import { CreditCard, Loader2 } from "lucide-react";

type Plan = {
  id: number;
  name: string;
  expireDays: number;
  price: number;
  occasions: number | null;
  isActive: boolean;
  joiningFee: number;
  joiningFeeAppliesOn: string;
  createdAt: Date;
};

export default function PlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const data = await getPlans();
      setPlans(data);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing(null);
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (plan: Plan) => {
    setEditing(plan);
    setErrors({});
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const joiningFeeRaw = fd.get("joiningFee") as string;
    const joiningFeeAppliesOn = (fd.get("joiningFeeAppliesOn") as string) || "first_only";
    const data = {
      name: fd.get("name") as string,
      expireDays: parseInt(fd.get("expireDays") as string, 10) || 0,
      price: parseFloat(fd.get("price") as string) || 0,
      occasions: (fd.get("occasions") as string)
        ? parseInt(fd.get("occasions") as string, 10) || null
        : null,
      joiningFee: joiningFeeRaw ? parseFloat(joiningFeeRaw) || 0 : 0,
      joiningFeeAppliesOn: joiningFeeAppliesOn as "first_only" | "every_renewal" | "never",
    };

    startTransition(async () => {
      const result = editing
        ? await updatePlan(editing.id, data)
        : await createPlan(data);
      if (result.errors) {
        setErrors(result.errors);
      } else {
        setDialogOpen(false);
        load();
      }
    });
  };

  const handleToggle = (id: number) => {
    startTransition(async () => {
      await togglePlanActive(id);
      load();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Plans</h1>
        <Button onClick={openCreate}>Add Plan</Button>
      </div>

      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="hidden md:table-cell">ID</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Price</TableHead>
            <TableHead className="hidden md:table-cell">Expire Days</TableHead>
            <TableHead className="hidden md:table-cell">Occasions</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plans.map((plan) => (
            <TableRow key={plan.id}>
              <TableCell className="hidden md:table-cell">{plan.id}</TableCell>
              <TableCell>{plan.name}</TableCell>
              <TableCell>{Number(plan.price).toFixed(2)}</TableCell>
              <TableCell className="hidden md:table-cell">{plan.expireDays}</TableCell>
              <TableCell className="hidden md:table-cell">{plan.occasions ?? "-"}</TableCell>
              <TableCell>
                <Badge variant={plan.isActive ? "default" : "secondary"}>
                  {plan.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="space-x-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(plan)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggle(plan.id)}
                  disabled={isPending}
                >
                  {plan.isActive ? "Deactivate" : "Activate"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {plans.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                <div className="flex flex-col items-center gap-2 py-8">
                  <CreditCard className="size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No plans found</p>
                  <Button variant="outline" size="sm" onClick={openCreate}>
                    Add Plan
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Plan" : "Add Plan"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={editing?.name ?? ""}
                key={editing?.id ?? "new"}
              />
              {errors.name && (
                <p className="text-xs text-destructive mt-1">{errors.name}</p>
              )}
            </div>
            <div>
              <Label htmlFor="price">Price</Label>
              <Input
                id="price"
                name="price"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing ? Number(editing.price) : ""}
                key={`price-${editing?.id ?? "new"}`}
              />
              {errors.price && (
                <p className="text-xs text-destructive mt-1">{errors.price}</p>
              )}
            </div>
            <div>
              <Label htmlFor="expireDays">Expire Days</Label>
              <Input
                id="expireDays"
                name="expireDays"
                type="number"
                min="1"
                defaultValue={editing?.expireDays ?? ""}
                key={`ed-${editing?.id ?? "new"}`}
              />
              {errors.expireDays && (
                <p className="text-xs text-destructive mt-1">{errors.expireDays}</p>
              )}
            </div>
            <div>
              <Label htmlFor="occasions">Occasions (optional)</Label>
              <Input
                id="occasions"
                name="occasions"
                type="number"
                min="1"
                defaultValue={editing?.occasions ?? ""}
                key={`occ-${editing?.id ?? "new"}`}
              />
            </div>
            <div>
              <Label htmlFor="joiningFee">Joining Fee (Rs.)</Label>
              <Input
                id="joiningFee"
                name="joiningFee"
                type="number"
                step="0.01"
                min="0"
                defaultValue={editing ? Number(editing.joiningFee) : 0}
                key={`jf-${editing?.id ?? "new"}`}
              />
              {errors.joiningFee && (
                <p className="text-xs text-destructive mt-1">{errors.joiningFee}</p>
              )}
            </div>
            <div>
              <Label htmlFor="joiningFeeAppliesOn">Joining Fee Applies</Label>
              <select
                id="joiningFeeAppliesOn"
                name="joiningFeeAppliesOn"
                defaultValue={editing?.joiningFeeAppliesOn ?? "first_only"}
                key={`jfa-${editing?.id ?? "new"}`}
                className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
              >
                <option value="first_only">First purchase only</option>
                <option value="every_renewal">Every renewal</option>
                <option value="never">Never</option>
              </select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                {editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
