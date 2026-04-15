"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  getEquipment,
  createEquipment,
  updateEquipment,
} from "@/lib/actions/equipment";
import { getLocations } from "@/lib/actions/locations";
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
import { SearchInput } from "@/components/ui/search-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Wrench } from "lucide-react";

const CATEGORIES = ["cardio", "strength", "free_weights", "accessories", "other"];
const CONDITIONS = ["good", "fair", "needs_repair", "out_of_service"];

type EquipmentItem = {
  id: number;
  name: string;
  category: string;
  locationId: number;
  locationName: string;
  purchaseDate: string | null;
  purchasePrice: number | null;
  condition: string;
  lastServiceDate: string | null;
  nextServiceDate: string | null;
  needsService: boolean;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
};

type Location = { id: number; name: string; code: string; address: string | null; phone: string | null; isActive: boolean; createdAt: Date };

function conditionColor(c: string): string {
  switch (c) {
    case "good":
      return "bg-status-active-bg text-status-active-foreground border-status-active/30";
    case "fair":
      return "bg-status-expiring-bg text-status-expiring-foreground border-status-expiring/30";
    case "needs_repair":
      return "bg-status-grace-bg text-status-grace-foreground border-status-grace/30";
    case "out_of_service":
      return "bg-status-expired-bg text-status-expired-foreground border-status-expired/30";
    default:
      return "";
  }
}

export default function EquipmentPage() {
  const [items, setItems] = useState<EquipmentItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [filterLocation, setFilterLocation] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [filterCondition, setFilterCondition] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EquipmentItem | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const [searchQuery, setSearchQuery] = useState("");

  const load = () => {
    startTransition(async () => {
      const locId = filterLocation ? Number(filterLocation) : undefined;
      const cat = filterCategory || undefined;
      const cond = filterCondition || undefined;
      const [data, locs] = await Promise.all([
        getEquipment(locId, cat, cond),
        getLocations(),
      ]);
      setItems(data);
      setLocations(locs);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterLocation, filterCategory, filterCondition]);

  const openCreate = () => {
    setEditing(null);
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (item: EquipmentItem) => {
    setEditing(item);
    setErrors({});
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      name: fd.get("name") as string,
      category: fd.get("category") as string,
      locationId: Number(fd.get("locationId")),
      purchaseDate: (fd.get("purchaseDate") as string) || undefined,
      purchasePrice: fd.get("purchasePrice")
        ? parseFloat(fd.get("purchasePrice") as string)
        : undefined,
      condition: fd.get("condition") as string,
      lastServiceDate: (fd.get("lastServiceDate") as string) || undefined,
      nextServiceDate: (fd.get("nextServiceDate") as string) || undefined,
      notes: (fd.get("notes") as string) || undefined,
    };

    startTransition(async () => {
      const result = editing
        ? await updateEquipment(editing.id, data)
        : await createEquipment(data);
      if (result.errors) {
        setErrors(result.errors);
      } else {
        setDialogOpen(false);
        load();
      }
    });
  };

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [items, searchQuery]);

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="shrink-0 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Equipment</h1>
        <Button onClick={openCreate}>Add Equipment</Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 sm:items-end sm:flex-wrap">
        <div>
          <Label>Location</Label>
          <Select value={filterLocation} onValueChange={(v) => setFilterLocation(v ?? "")}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All">{filterLocation && filterLocation !== "all" ? locations.find((l) => String(l.id) === filterLocation)?.name ?? "All" : "All"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Category</Label>
          <Select value={filterCategory} onValueChange={(v) => setFilterCategory(v ?? "")}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  <span className="capitalize">{c.replace("_", " ")}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Condition</Label>
          <Select value={filterCondition} onValueChange={(v) => setFilterCondition(v ?? "")}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {CONDITIONS.map((c) => (
                <SelectItem key={c} value={c}>
                  <span className="capitalize">{c.replace("_", " ")}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <SearchInput
        placeholder="Search equipment name..."
        onSearch={setSearchQuery}
        className="w-full sm:w-64"
      />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="hidden md:table-cell">Location</TableHead>
            <TableHead>Condition</TableHead>
            <TableHead className="hidden lg:table-cell">Last Service</TableHead>
            <TableHead className="hidden md:table-cell">Next Service</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredItems.map((item) => (
            <TableRow
              key={item.id}
              className={item.needsService ? "bg-status-grace-bg/50" : ""}
            >
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell>
                <Badge variant="outline" className="capitalize">
                  {item.category.replace("_", " ")}
                </Badge>
              </TableCell>
              <TableCell className="hidden md:table-cell">{item.locationName}</TableCell>
              <TableCell>
                <Badge className={conditionColor(item.condition)}>
                  {item.condition.replace("_", " ")}
                </Badge>
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                {item.lastServiceDate
                  ? new Date(item.lastServiceDate).toLocaleDateString("en-IN")
                  : "-"}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {item.nextServiceDate ? (
                  <span
                    className={item.needsService ? "text-status-grace-foreground font-semibold" : ""}
                  >
                    {new Date(item.nextServiceDate).toLocaleDateString("en-IN")}
                    {item.needsService && " (overdue)"}
                  </span>
                ) : (
                  "-"
                )}
              </TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEdit(item)}
                >
                  Edit
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                <div className="flex flex-col items-center gap-2 py-8">
                  <Wrench className="size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No equipment found</p>
                  <Button variant="outline" size="sm" onClick={openCreate}>
                    Add Equipment
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
            <DialogTitle>
              {editing ? "Edit Equipment" : "Add Equipment"}
            </DialogTitle>
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
              <Label htmlFor="category">Category</Label>
              <select
                id="category"
                name="category"
                defaultValue={editing?.category ?? ""}
                key={`cat-${editing?.id ?? "new"}`}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">Select...</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace("_", " ")}
                  </option>
                ))}
              </select>
              {errors.category && (
                <p className="text-xs text-destructive mt-1">{errors.category}</p>
              )}
            </div>
            <div>
              <Label htmlFor="locationId">Location</Label>
              <select
                id="locationId"
                name="locationId"
                defaultValue={editing?.locationId ?? ""}
                key={`loc-${editing?.id ?? "new"}`}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">Select...</option>
                {locations.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.name}
                  </option>
                ))}
              </select>
              {errors.locationId && (
                <p className="text-xs text-destructive mt-1">
                  {errors.locationId}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="condition">Condition</Label>
              <select
                id="condition"
                name="condition"
                defaultValue={editing?.condition ?? "good"}
                key={`cond-${editing?.id ?? "new"}`}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                {CONDITIONS.map((c) => (
                  <option key={c} value={c}>
                    {c.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="purchaseDate">Purchase Date</Label>
              <Input
                id="purchaseDate"
                name="purchaseDate"
                type="date"
                defaultValue={editing?.purchaseDate?.split("T")[0] ?? ""}
                key={`pd-${editing?.id ?? "new"}`}
              />
            </div>
            <div>
              <Label htmlFor="purchasePrice">Purchase Price</Label>
              <Input
                id="purchasePrice"
                name="purchasePrice"
                type="number"
                step="0.01"
                defaultValue={editing?.purchasePrice ?? ""}
                key={`pp-${editing?.id ?? "new"}`}
              />
            </div>
            <div>
              <Label htmlFor="lastServiceDate">Last Service Date</Label>
              <Input
                id="lastServiceDate"
                name="lastServiceDate"
                type="date"
                defaultValue={editing?.lastServiceDate?.split("T")[0] ?? ""}
                key={`lsd-${editing?.id ?? "new"}`}
              />
            </div>
            <div>
              <Label htmlFor="nextServiceDate">Next Service Date</Label>
              <Input
                id="nextServiceDate"
                name="nextServiceDate"
                type="date"
                defaultValue={editing?.nextServiceDate?.split("T")[0] ?? ""}
                key={`nsd-${editing?.id ?? "new"}`}
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                name="notes"
                defaultValue={editing?.notes ?? ""}
                key={`notes-${editing?.id ?? "new"}`}
              />
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
