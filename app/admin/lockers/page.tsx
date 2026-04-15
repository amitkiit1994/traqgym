"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getLockersAction,
  createLockerAction,
  assignLockerAction,
  releaseLockerAction,
  setLockerMaintenanceAction,
  deleteLockerAction,
  markLockerAvailableAction,
  getLockerStatsAction,
} from "@/lib/actions/lockers";
import { getLocations } from "@/lib/actions/locations";
import { getMembers } from "@/lib/actions/members";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Lock, Plus, Search, Wrench, Trash2, UserPlus, UserMinus } from "lucide-react";

type LockerItem = {
  id: number;
  number: string;
  locationId: number;
  locationName: string;
  status: string;
  assignedTo: number | null;
  assignedUserName: string | null;
  assignedUserPhone: string | null;
  assignedAt: string | null;
  notes: string | null;
  createdAt: string;
};

type Location = { id: number; name: string; code: string; address: string | null; phone: string | null; isActive: boolean; createdAt: Date };
type Stats = { available: number; assigned: number; maintenance: number; total: number };
type MemberResult = { id: number; firstname: string; lastname: string; phone: string };

function statusColor(s: string): string {
  switch (s) {
    case "available":
      return "bg-status-active-bg text-status-active-foreground border-status-active/30";
    case "assigned":
      return "bg-status-expiring-bg text-status-expiring-foreground border-status-expiring/30";
    case "maintenance":
      return "bg-status-expired-bg text-status-expired-foreground border-status-expired/30";
    default:
      return "";
  }
}

export default function LockersPage() {
  const [lockers, setLockers] = useState<LockerItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [stats, setStats] = useState<Stats>({ available: 0, assigned: 0, maintenance: 0, total: 0 });
  const [filterLocation, setFilterLocation] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  // Dialogs
  const [addOpen, setAddOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignLockerId, setAssignLockerId] = useState<number | null>(null);
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [maintenanceLockerId, setMaintenanceLockerId] = useState<number | null>(null);
  const [maintenanceNotes, setMaintenanceNotes] = useState("");
  const [error, setError] = useState("");

  // Member search for assign
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<MemberResult[]>([]);
  const [searchPending, setSearchPending] = useState(false);

  const locId = filterLocation && filterLocation !== "all" ? Number(filterLocation) : undefined;

  const load = () => {
    startTransition(async () => {
      const [data, locs, st] = await Promise.all([
        getLockersAction(locId),
        getLocations(),
        getLockerStatsAction(locId),
      ]);
      setLockers(data);
      setLocations(locs);
      setStats(st);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterLocation]);

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const number = (fd.get("number") as string).trim();
    const locationId = Number(fd.get("locationId"));
    if (!number || !locationId) {
      setError("Locker number and location are required");
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await createLockerAction({ number, locationId });
      if ("error" in result && result.error) {
        setError(result.error);
      } else {
        setAddOpen(false);
        setError("");
        load();
      }
    });
  };

  const handleAssign = (userId: number) => {
    if (!assignLockerId) return;
    startTransition(async () => {
      const result = await assignLockerAction(assignLockerId, userId);
      if ("error" in result && result.error) {
        setError(result.error);
      } else {
        setAssignOpen(false);
        setAssignLockerId(null);
        setMemberSearch("");
        setMemberResults([]);
        setError("");
        load();
      }
    });
  };

  const handleRelease = (lockerId: number) => {
    startTransition(async () => {
      await releaseLockerAction(lockerId);
      load();
    });
  };

  const handleMaintenance = () => {
    if (!maintenanceLockerId) return;
    startTransition(async () => {
      await setLockerMaintenanceAction(maintenanceLockerId, maintenanceNotes || undefined);
      setMaintenanceOpen(false);
      setMaintenanceLockerId(null);
      setMaintenanceNotes("");
      load();
    });
  };

  const handleDelete = (lockerId: number) => {
    startTransition(async () => {
      const result = await deleteLockerAction(lockerId);
      if ("error" in result && result.error) {
        setError(result.error);
      } else {
        load();
      }
    });
  };

  const searchMembers = (query: string) => {
    setMemberSearch(query);
    if (query.length < 2) {
      setMemberResults([]);
      return;
    }
    setSearchPending(true);
    getMembers({ search: query, pageSize: 10 }).then((res) => {
      const members = "members" in res ? res.members : [];
      setMemberResults(
        members.map((m: { id: number; firstname: string; lastname: string; phone: string | null }) => ({
          id: m.id,
          firstname: m.firstname,
          lastname: m.lastname,
          phone: m.phone || "",
        }))
      );
      setSearchPending(false);
    });
  };

  const openAssign = (lockerId: number) => {
    setAssignLockerId(lockerId);
    setMemberSearch("");
    setMemberResults([]);
    setError("");
    setAssignOpen(true);
  };

  const openMaintenance = (lockerId: number) => {
    setMaintenanceLockerId(lockerId);
    setMaintenanceNotes("");
    setMaintenanceOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Locker Management</h1>
        <Button onClick={() => { setError(""); setAddOpen(true); }}>
          <Plus className="size-4 mr-1" />
          Add Locker
        </Button>
      </div>

      {/* Location filter */}
      {locations.length > 1 && (
        <div className="flex gap-3 items-end">
          <div>
            <Label>Location</Label>
            <Select value={filterLocation} onValueChange={(v) => setFilterLocation(v ?? "")}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All Locations">
                  {filterLocation && filterLocation !== "all"
                    ? locations.find((l) => String(l.id) === filterLocation)?.name ?? "All"
                    : "All Locations"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total</p>
            <p className="text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Available</p>
            <p className="text-2xl font-bold text-green-500">{stats.available}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Assigned</p>
            <p className="text-2xl font-bold text-yellow-500">{stats.assigned}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Maintenance</p>
            <p className="text-2xl font-bold text-red-500">{stats.maintenance}</p>
          </CardContent>
        </Card>
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Lockers table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Locker #</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Assigned To</TableHead>
            <TableHead className="hidden md:table-cell">Assigned Date</TableHead>
            <TableHead className="hidden md:table-cell">Location</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lockers.map((locker) => (
            <TableRow key={locker.id}>
              <TableCell className="font-medium">{locker.number}</TableCell>
              <TableCell>
                <Badge className={statusColor(locker.status)}>
                  {locker.status}
                </Badge>
              </TableCell>
              <TableCell>
                {locker.assignedUserName ? (
                  <div>
                    <span className="font-medium">{locker.assignedUserName}</span>
                    {locker.assignedUserPhone && (
                      <span className="text-xs text-muted-foreground ml-1">({locker.assignedUserPhone})</span>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {locker.assignedAt
                  ? new Date(locker.assignedAt).toLocaleDateString("en-IN")
                  : "-"}
              </TableCell>
              <TableCell className="hidden md:table-cell">{locker.locationName}</TableCell>
              <TableCell>
                <div className="flex gap-1 flex-wrap">
                  {locker.status === "available" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openAssign(locker.id)}
                        title="Assign"
                      >
                        <UserPlus className="size-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openMaintenance(locker.id)}
                        title="Maintenance"
                      >
                        <Wrench className="size-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(locker.id)}
                        title="Delete"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                  {locker.status === "assigned" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRelease(locker.id)}
                      title="Release"
                    >
                      <UserMinus className="size-3.5" />
                    </Button>
                  )}
                  {locker.status === "maintenance" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        startTransition(async () => {
                          await markLockerAvailableAction(locker.id);
                          load();
                        });
                      }}
                      title="Mark Available"
                      className="text-green-600 hover:text-green-600"
                    >
                      Available
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {lockers.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                <div className="flex flex-col items-center gap-2 py-8">
                  <Lock className="size-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No lockers found</p>
                  <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                    Add Locker
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Add Locker Dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Locker</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <Label htmlFor="number">Locker Number</Label>
              <Input id="number" name="number" placeholder="e.g. L-01" />
            </div>
            <div>
              <Label htmlFor="locationId">Location</Label>
              <select
                id="locationId"
                name="locationId"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">Select...</option>
                {locations.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Assign Locker Dialog */}
      <Dialog open={assignOpen} onOpenChange={(v) => { setAssignOpen(v); if (!v) setError(""); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Locker</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Search Member</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or phone..."
                  className="pl-8"
                  value={memberSearch}
                  onChange={(e) => searchMembers(e.target.value)}
                />
              </div>
            </div>
            {searchPending && (
              <div className="flex justify-center py-2">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {memberResults.length > 0 && (
              <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
                {memberResults.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleAssign(m.id)}
                    disabled={isPending}
                    className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors text-sm flex justify-between items-center"
                  >
                    <span className="font-medium">
                      {m.firstname} {m.lastname}
                    </span>
                    <span className="text-muted-foreground text-xs">{m.phone}</span>
                  </button>
                ))}
              </div>
            )}
            {memberSearch.length >= 2 && !searchPending && memberResults.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">No members found</p>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* Maintenance Dialog */}
      <Dialog open={maintenanceOpen} onOpenChange={setMaintenanceOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Maintenance</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="mNotes">Notes (optional)</Label>
              <Input
                id="mNotes"
                value={maintenanceNotes}
                onChange={(e) => setMaintenanceNotes(e.target.value)}
                placeholder="Reason for maintenance..."
              />
            </div>
            <DialogFooter>
              <Button onClick={handleMaintenance} disabled={isPending}>
                {isPending && <Loader2 className="size-4 animate-spin" />}
                Confirm
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
