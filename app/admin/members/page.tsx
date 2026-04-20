"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getMembers, createMember, importMembersFromCSV } from "@/lib/actions/members";
import { getLocations } from "@/lib/actions/locations";
import { getPlans } from "@/lib/actions/plans";
import { SearchInput } from "@/components/ui/search-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronUp, ChevronDown, Users, Loader2, Download, Archive } from "lucide-react";
import { toCsv } from "@/lib/utils/csv-export";
import Link from "next/link";

type MemberRow = {
  id: number;
  firstname: string;
  lastname: string;
  email: string;
  phone: string | null;
  locationName: string;
  status: "active" | "expired" | "no_plan";
  planId: number | null;
  planName: string | null;
  riskLevel: "low" | "medium" | "high";
  riskReason: string;
};

type LocationOption = {
  id: number;
  name: string;
  isActive: boolean;
};

type PlanOption = {
  id: number;
  name: string;
  isActive: boolean;
};

const statusVariant: Record<string, "active" | "expired" | "secondary" | "expiring"> = {
  active: "active",
  expired: "expired",
  no_plan: "secondary",
  expiring: "expiring",
  inactive: "secondary",
};

const statusLabel: Record<string, string> = {
  active: "Active",
  expired: "Expired",
  no_plan: "No Plan",
  expiring: "Expiring",
  inactive: "Inactive 7d",
};

const riskVariant: Record<string, "active" | "expiring" | "destructive"> = {
  low: "active",
  medium: "expiring",
  high: "destructive",
};

const riskLabel: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const PAGE_SIZE = 25;

export default function MembersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(() => {
    const p = searchParams.get("page");
    return p ? parseInt(p, 10) : 1;
  });
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planFilter, setPlanFilter] = useState<string>(() => searchParams.get("planId") ?? "all");
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvResult, setCsvResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);
  const [csvImporting, setCsvImporting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [birthdayFilter] = useState<string>(() => searchParams.get("birthday") ?? "");
  const [statusFilter, setStatusFilter] = useState<string>(() => searchParams.get("status") ?? "all");
  const [sortBy, setSortBy] = useState<"name" | "status" | "location">(() => {
    const s = searchParams.get("sort");
    return s === "status" || s === "location" ? s : "name";
  });
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(() => {
    return searchParams.get("order") === "desc" ? "desc" : "asc";
  });
  const [showAllExpired, setShowAllExpired] = useState(false);
  const [selectedGender, setSelectedGender] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState("");

  const updateUrl = (params: Record<string, string>) => {
    const url = new URL(window.location.href);
    Object.entries(params).forEach(([k, v]) => {
      if (v && v !== "all" && v !== "1" && v !== "name" && v !== "asc") {
        url.searchParams.set(k, v);
      } else {
        url.searchParams.delete(k);
      }
    });
    router.replace(url.pathname + url.search, { scroll: false });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = (q?: string, p?: number, status?: string, allExpired?: boolean, plan?: string) => {
    const currentPage = p ?? page;
    const currentStatus = status ?? statusFilter;
    const currentAllExpired = allExpired ?? showAllExpired;
    const currentPlan = plan ?? planFilter;
    const planIdNum = currentPlan && currentPlan !== "all" ? Number(currentPlan) : undefined;
    startTransition(async () => {
      const data = await getMembers({
        search: q || undefined,
        page: currentPage,
        pageSize: PAGE_SIZE,
        status: currentStatus !== "all" ? currentStatus as "active" | "expired" | "no_plan" | "expiring" | "inactive" : undefined,
        birthday: birthdayFilter || undefined,
        sortBy,
        sortOrder,
        showAllExpired: currentStatus === "expired" ? currentAllExpired : undefined,
        planId: Number.isFinite(planIdNum) ? planIdNum : undefined,
      });
      setMembers(data.members);
      setTotal(data.total);
    });
  };

  useEffect(() => {
    load();
    getLocations().then((locs) => setLocations(locs));
    getPlans().then((ps) =>
      setPlans(
        ps
          .filter((p) => p.isActive)
          .map((p) => ({ id: p.id, name: p.name, isActive: p.isActive }))
          .sort((a, b) => a.name.localeCompare(b.name))
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load(search, page, statusFilter, undefined, planFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, sortOrder]);

  const goToPage = (p: number) => {
    setPage(p);
    load(search, p, statusFilter, undefined, planFilter);
    updateUrl({ q: search, status: statusFilter, planId: planFilter, page: String(p), sort: sortBy, order: sortOrder });
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const result = await createMember({
      firstname: fd.get("firstname") as string,
      lastname: fd.get("lastname") as string,
      email: fd.get("email") as string,
      phone: (fd.get("phone") as string) || undefined,
      gender: selectedGender || undefined,
      locationId: selectedLocationId ? parseInt(selectedLocationId, 10) : null,
    });
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setSelectedGender("");
    setSelectedLocationId("");
    setDialogOpen(false);
    load(search);
  };

  const handleCsvImport = async () => {
    if (!csvFile) return;
    setCsvImporting(true);
    setCsvResult(null);
    try {
      const text = await csvFile.text();
      const result = await importMembersFromCSV(text);
      setCsvResult(result);
      load(search);
    } catch {
      setCsvResult({ created: 0, skipped: 0, errors: ["Import failed unexpectedly"] });
    } finally {
      setCsvImporting(false);
    }
  };

  const handleExport = () => {
    const headers = ["Name", "Email", "Phone", "Location", "Plan", "Status"];
    const rows = members.map((m) => [
      `${m.firstname} ${m.lastname}`,
      m.email,
      m.phone ?? "",
      m.locationName,
      m.planName ?? "",
      statusLabel[m.status],
    ]);
    const csv = toCsv(headers, rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `members-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activeLocations = locations.filter((l) => l.isActive);

  function SortableHead({ field, children }: { field: "name" | "status" | "location"; children: React.ReactNode }) {
    const isActive = sortBy === field;
    return (
      <TableHead>
        <button
          type="button"
          className="flex items-center gap-1 hover:text-foreground"
          onClick={() => {
            if (sortBy === field) {
              const newOrder = sortOrder === "asc" ? "desc" : "asc";
              setSortOrder(newOrder);
              updateUrl({ q: search, status: statusFilter, planId: planFilter, page: String(page), sort: field, order: newOrder });
            } else {
              setSortBy(field);
              setSortOrder("asc");
              updateUrl({ q: search, status: statusFilter, planId: planFilter, page: String(page), sort: field, order: "asc" });
            }
          }}
        >
          {children}
          {isActive && (sortOrder === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
        </button>
      </TableHead>
    );
  }

  return (
    <div className="h-full flex flex-col gap-3 overflow-hidden">
      <div className="shrink-0 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Members</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={members.length === 0}>
            <Download className="size-4" />
            Export
          </Button>
          <Dialog open={csvDialogOpen} onOpenChange={(open) => { setCsvDialogOpen(open); if (!open) { setCsvFile(null); setCsvResult(null); } }}>
            <DialogTrigger render={<Button variant="outline" />}>Import CSV</DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Import Members from CSV</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Expected format: <code className="text-xs bg-muted px-1 py-0.5 rounded">firstname,lastname,email,phone,gender,location_code</code>
                </p>
                <p className="text-xs text-muted-foreground">
                  First row must be header. Password is set to the phone number or &quot;welcome123&quot;.
                </p>
                <Input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    setCsvFile(e.target.files?.[0] || null);
                    setCsvResult(null);
                  }}
                />
                {csvResult && (
                  <div className="space-y-1 text-sm">
                    <p className="text-status-active-foreground">Created: {csvResult.created}</p>
                    <p className="text-status-expiring-foreground">Skipped (duplicate email): {csvResult.skipped}</p>
                    {csvResult.errors.length > 0 && (
                      <div className="text-destructive">
                        {csvResult.errors.map((err, i) => (
                          <p key={i}>{err}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <DialogFooter>
                  <Button onClick={handleCsvImport} disabled={!csvFile || csvImporting}>
                    {csvImporting && <Loader2 className="size-4 animate-spin" />}
                    {csvImporting ? "Importing..." : "Import"}
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button />}>New Member</DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New Member</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <Label htmlFor="firstname">First Name *</Label>
                <Input id="firstname" name="firstname" required />
                {errors.firstname && (
                  <p className="text-xs text-destructive mt-1">{errors.firstname}</p>
                )}
              </div>
              <div>
                <Label htmlFor="lastname">Last Name *</Label>
                <Input id="lastname" name="lastname" required />
                {errors.lastname && (
                  <p className="text-xs text-destructive mt-1">{errors.lastname}</p>
                )}
              </div>
              <div>
                <Label htmlFor="email">Email *</Label>
                <Input id="email" name="email" type="email" required />
                {errors.email && (
                  <p className="text-xs text-destructive mt-1">{errors.email}</p>
                )}
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" />
              </div>
              <div>
                <Label>Gender</Label>
                <Select value={selectedGender} onValueChange={(v) => setSelectedGender(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Location</Label>
                <Select value={selectedLocationId} onValueChange={(v) => setSelectedLocationId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select location">{selectedLocationId ? activeLocations.find((l) => String(l.id) === selectedLocationId)?.name ?? "Select location" : "Select location"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {activeLocations.map((loc) => (
                      <SelectItem key={loc.id} value={String(loc.id)}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                Password will be set to the phone number, or &quot;welcome123&quot; if no phone is provided.
              </p>
              <DialogFooter>
                <Button type="submit">Create Member</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          placeholder="Search by name, email, or phone..."
          defaultValue={search}
          onSearch={(q) => {
            setSearch(q);
            setPage(1);
            load(q, 1, statusFilter, undefined, planFilter);
            updateUrl({ q, status: statusFilter, planId: planFilter, page: "1", sort: sortBy, order: sortOrder });
          }}
          isPending={isPending}
          className="w-full sm:w-auto sm:min-w-[250px]"
        />
        <Select
          value={planFilter}
          onValueChange={(v) => {
            const next = v ?? "all";
            setPlanFilter(next);
            setPage(1);
            load(search, 1, statusFilter, undefined, next);
            updateUrl({ q: search, status: statusFilter, planId: next, page: "1", sort: sortBy, order: sortOrder });
          }}
        >
          <SelectTrigger className="min-w-[160px]" size="sm">
            <SelectValue placeholder="All plans">
              {planFilter === "all"
                ? "All plans"
                : plans.find((p) => String(p.id) === planFilter)?.name ?? "All plans"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent align="start" alignItemWithTrigger={false}>
            <SelectItem value="all">All plans</SelectItem>
            {plans.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          {[
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "expired", label: "Expired" },
            { value: "expiring", label: "Expiring" },
            { value: "inactive", label: "Inactive 7d" },
            { value: "no_plan", label: "No Plan" },
          ].map((s) => (
            <Button
              key={s.value}
              variant={statusFilter === s.value ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setStatusFilter(s.value);
                setPage(1);
                load(search, 1, s.value, undefined, planFilter);
                updateUrl({ q: search, status: s.value, planId: planFilter, page: "1", sort: sortBy, order: sortOrder });
              }}
            >
              {s.label}
            </Button>
          ))}
        </div>
        {statusFilter === "expired" && (
          <Button
            variant={showAllExpired ? "default" : "outline"}
            size="sm"
            onClick={() => {
              const next = !showAllExpired;
              setShowAllExpired(next);
              setPage(1);
              load(search, 1, "expired", next);
            }}
            className="gap-1.5"
          >
            <Archive className="size-3.5" />
            {showAllExpired ? "Showing all expired" : "Show all time"}
          </Button>
        )}
      </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto sm:rounded-lg sm:ring-1 sm:ring-foreground/5 sm:dark:ring-white/[0.06]">
      {/* Mobile card view (<sm) */}
      <div className="sm:hidden space-y-2">
        {members.map((m) => (
          <Card key={m.id} size="sm">
            <CardContent className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {m.firstname} {m.lastname}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {m.email}
                  </div>
                  {m.phone && (
                    <div className="text-xs text-muted-foreground truncate">
                      {m.phone}
                    </div>
                  )}
                </div>
                <Badge variant={statusVariant[m.status]}>
                  {statusLabel[m.status]}
                </Badge>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Location</dt>
                <dd className="text-right truncate">{m.locationName}</dd>
                <dt className="text-muted-foreground">Plan</dt>
                <dd className="text-right">
                  <Badge variant="outline">{m.planName ?? "—"}</Badge>
                </dd>
                <dt className="text-muted-foreground">Risk</dt>
                <dd className="text-right">
                  <Badge variant={riskVariant[m.riskLevel]} title={m.riskReason}>
                    {riskLabel[m.riskLevel]}
                  </Badge>
                </dd>
              </dl>
              <Link href={`/admin/members/${m.id}`} className="block">
                <Button variant="outline" className="w-full min-h-11">
                  View
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
        {members.length === 0 && (
          <Card size="sm">
            <CardContent>
              <div className="flex flex-col items-center gap-2 py-8">
                <Users className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground text-center">
                  {planFilter !== "all"
                    ? `No ${statusFilter !== "all" ? statusFilter + " " : ""}members on ${plans.find((p) => String(p.id) === planFilter)?.name ?? "this plan"}`
                    : statusFilter !== "all"
                      ? `No ${statusFilter} members`
                      : search
                        ? `No members match "${search}"`
                        : "No members found"}
                </p>
                <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
                  Add Member
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Desktop table view (sm+) */}
      <div className="hidden sm:block">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead field="name">Name</SortableHead>
            <TableHead className="hidden md:table-cell">Email</TableHead>
            <TableHead className="hidden md:table-cell">Phone</TableHead>
            <SortableHead field="location">Location</SortableHead>
            <TableHead>Plan</TableHead>
            <SortableHead field="status">Status</SortableHead>
            <TableHead className="hidden sm:table-cell">Risk</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                {m.firstname} {m.lastname}
              </TableCell>
              <TableCell className="hidden md:table-cell">{m.email}</TableCell>
              <TableCell className="hidden md:table-cell">{m.phone ?? "-"}</TableCell>
              <TableCell>{m.locationName}</TableCell>
              <TableCell>
                <Badge variant="outline">{m.planName ?? "—"}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant[m.status]}>
                  {statusLabel[m.status]}
                </Badge>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <Badge variant={riskVariant[m.riskLevel]} title={m.riskReason}>
                  {riskLabel[m.riskLevel]}
                </Badge>
              </TableCell>
              <TableCell>
                <Link href={`/admin/members/${m.id}`}>
                  <Button variant="outline" size="sm">
                    View
                  </Button>
                </Link>
              </TableCell>
            </TableRow>
          ))}
          {members.length === 0 && (
            <TableRow>
              <TableCell colSpan={8}>
                <div className="flex flex-col items-center gap-2 py-8">
                  <Users className="size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    {planFilter !== "all"
                      ? `No ${statusFilter !== "all" ? statusFilter + " " : ""}members on ${plans.find((p) => String(p.id) === planFilter)?.name ?? "this plan"}`
                      : statusFilter !== "all"
                        ? `No ${statusFilter} members`
                        : search
                          ? `No members match "${search}"`
                          : "No members found"}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
                    Add Member
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      </div>
      </div>

      {totalPages > 1 && (
        <div className="shrink-0">
          <div className="flex items-center justify-center gap-4 py-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isPending}
              onClick={() => goToPage(page - 1)}
            >
              Prev
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isPending}
              onClick={() => goToPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
