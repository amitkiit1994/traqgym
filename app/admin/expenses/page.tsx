"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getExpenses,
  createExpense,
  updateExpense,
  getExpenseSummary,
} from "@/lib/actions/expenses";
import { getLocations } from "@/lib/actions/locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from "@/components/ui/table";
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
import { ChevronUp, ChevronDown, Receipt, Loader2, Download } from "lucide-react";
import { toCsv } from "@/lib/utils/csv-export";

const CATEGORIES = [
  "rent",
  "salary",
  "equipment",
  "maintenance",
  "utilities",
  "marketing",
  "other",
];

const PAID_BY_OPTIONS = ["cash", "upi", "bank_transfer"];

type Expense = {
  id: number;
  category: string;
  description: string;
  amount: number;
  expenseDate: string;
  locationId: number | null;
  locationName: string;
  paidBy: string | null;
  receipt: string | null;
  recordedBy: number | null;
  createdAt: string;
};

type Location = { id: number; name: string; code: string; address: string | null; phone: string | null; isActive: boolean; createdAt: Date };

type Summary = {
  total: number;
  byCategory: { category: string; total: number }[];
};

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, byCategory: [] });
  const [month, setMonth] = useState(currentMonth());
  const [filterLocation, setFilterLocation] = useState<string>("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const [sortField, setSortField] = useState<"date" | "amount" | "category">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = () => {
    startTransition(async () => {
      const locId = filterLocation ? Number(filterLocation) : undefined;
      const cat = filterCategory || undefined;
      const [data, locs, sum] = await Promise.all([
        getExpenses(month, locId, cat),
        getLocations(),
        getExpenseSummary(month, locId),
      ]);
      setExpenses(data);
      setLocations(locs);
      setSummary(sum);
    });
  };

  // Auto-select single location on first load
  const [locInitDone, setLocInitDone] = useState(false);
  useEffect(() => {
    if (!locInitDone && locations.length === 1 && !filterLocation) {
      setFilterLocation(String(locations[0].id));
      setLocInitDone(true);
    }
  }, [locations, locInitDone, filterLocation]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, filterLocation, filterCategory]);

  const openCreate = () => {
    setEditing(null);
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (exp: Expense) => {
    setEditing(exp);
    setErrors({});
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      category: fd.get("category") as string,
      description: fd.get("description") as string,
      amount: parseFloat(fd.get("amount") as string),
      expenseDate: fd.get("expenseDate") as string,
      locationId: fd.get("locationId") ? Number(fd.get("locationId")) : undefined,
      paidBy: (fd.get("paidBy") as string) || undefined,
      receipt: (fd.get("receipt") as string) || undefined,
    };

    startTransition(async () => {
      const result = editing
        ? await updateExpense(editing.id, data)
        : await createExpense(data);
      if (result.errors) {
        setErrors(result.errors);
      } else {
        setDialogOpen(false);
        load();
      }
    });
  };

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(n);

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const sortedExpenses = [...expenses].sort((a, b) => {
    let cmp = 0;
    if (sortField === "date") cmp = new Date(a.expenseDate).getTime() - new Date(b.expenseDate).getTime();
    else if (sortField === "amount") cmp = a.amount - b.amount;
    else if (sortField === "category") cmp = a.category.localeCompare(b.category);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const handleExport = () => {
    const headers = ["Date", "Description", "Category", "Amount", "Location", "Added By"];
    const rows = sortedExpenses.map((e) => [
      new Date(e.expenseDate).toLocaleDateString("en-IN"),
      e.description,
      e.category,
      String(e.amount),
      e.locationName,
      e.paidBy ?? "",
    ]);
    const csv = toCsv(headers, rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const SortIcon = ({ field, current, dir }: { field: string; current: string; dir: "asc" | "desc" }) =>
    field === current ? (dir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />) : null;

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Expenses</h1>
        <Button onClick={openCreate}>New Expense</Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Total Expenses This Month
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{fmt(summary.total)}</p>
          </CardContent>
        </Card>
        {summary.byCategory.slice(0, 3).map((c) => (
          <Card key={c.category}>
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground capitalize">
                {c.category}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{fmt(c.total)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-end flex-wrap">
        <Button variant="outline" size="sm" onClick={handleExport} disabled={expenses.length === 0} className="self-end">
          <Download className="size-4" />
          Export
        </Button>
        <div>
          <Label>Month</Label>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-40"
          />
        </div>
        {locations.length > 1 ? (
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
        ) : locations.length === 1 ? (
          <div>
            <Label>Location</Label>
            <span className="flex h-9 items-center text-sm text-muted-foreground">{locations[0].name}</span>
          </div>
        ) : null}
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
                  <span className="capitalize">{c}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("date")}>
                Date <SortIcon field="date" current={sortField} dir={sortDir} />
              </button>
            </TableHead>
            <TableHead>
              <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("category")}>
                Category <SortIcon field="category" current={sortField} dir={sortDir} />
              </button>
            </TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">
              <button type="button" className="flex items-center gap-1 hover:text-foreground ml-auto" onClick={() => toggleSort("amount")}>
                Amount <SortIcon field="amount" current={sortField} dir={sortDir} />
              </button>
            </TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Paid By</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedExpenses.map((exp) => (
            <TableRow key={exp.id}>
              <TableCell>
                {new Date(exp.expenseDate).toLocaleDateString("en-IN")}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="capitalize">
                  {exp.category}
                </Badge>
              </TableCell>
              <TableCell>{exp.description}</TableCell>
              <TableCell className="text-right">{fmt(exp.amount)}</TableCell>
              <TableCell>{exp.locationName}</TableCell>
              <TableCell className="capitalize">{exp.paidBy ?? "-"}</TableCell>
              <TableCell>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEdit(exp)}
                >
                  Edit
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {expenses.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                <div className="flex flex-col items-center gap-2 py-8">
                  <Receipt className="size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No expenses found</p>
                  <Button variant="outline" size="sm" onClick={openCreate}>
                    Add Expense
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
        {expenses.length > 0 && (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-semibold">
                Total
              </TableCell>
              <TableCell className="text-right font-semibold">
                {fmt(total)}
              </TableCell>
              <TableCell colSpan={3} />
            </TableRow>
          </TableFooter>
        )}
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Expense" : "New Expense"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label htmlFor="category">Category</Label>
              <select
                id="category"
                name="category"
                defaultValue={editing?.category ?? ""}
                key={editing?.id ?? "new"}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">Select...</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {errors.category && (
                <p className="text-xs text-destructive mt-1">{errors.category}</p>
              )}
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                defaultValue={editing?.description ?? ""}
                key={`desc-${editing?.id ?? "new"}`}
              />
              {errors.description && (
                <p className="text-xs text-destructive mt-1">
                  {errors.description}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                step="0.01"
                defaultValue={editing?.amount ?? ""}
                key={`amt-${editing?.id ?? "new"}`}
              />
              {errors.amount && (
                <p className="text-xs text-destructive mt-1">{errors.amount}</p>
              )}
            </div>
            <div>
              <Label htmlFor="expenseDate">Date</Label>
              <Input
                id="expenseDate"
                name="expenseDate"
                type="date"
                defaultValue={
                  editing
                    ? editing.expenseDate.split("T")[0]
                    : new Date().toISOString().split("T")[0]
                }
                key={`date-${editing?.id ?? "new"}`}
              />
              {errors.expenseDate && (
                <p className="text-xs text-destructive mt-1">
                  {errors.expenseDate}
                </p>
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
                <option value="">None</option>
                {locations.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="paidBy">Paid By</Label>
              <select
                id="paidBy"
                name="paidBy"
                defaultValue={editing?.paidBy ?? ""}
                key={`pay-${editing?.id ?? "new"}`}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">Select...</option>
                {PAID_BY_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="receipt">Receipt Reference</Label>
              <Input
                id="receipt"
                name="receipt"
                defaultValue={editing?.receipt ?? ""}
                key={`rcpt-${editing?.id ?? "new"}`}
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
