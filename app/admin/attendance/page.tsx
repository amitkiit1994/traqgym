"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getDailyAttendance,
  getAttendanceLocations,
  manualCheckIn,
} from "@/lib/actions/attendance";
import { searchMembers } from "@/lib/actions/renewals";
import {
  getWorkerDailyAttendance,
  getWorkersList,
  workerCheckIn,
  workerCheckOut,
} from "@/lib/actions/worker-attendance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateQuickSelect } from "@/components/ui/date-quick-select";
import { Badge } from "@/components/ui/badge";
import { ChevronUp, ChevronDown, Calendar, Loader2, Download } from "lucide-react";
import { toCsv } from "@/lib/utils/csv-export";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AttendanceRow = {
  id: number;
  memberName: string;
  checkIn: string;
  checkOut: string | null;
  source: string;
  locationName: string;
};

type WorkerAttendanceRow = {
  id: number;
  workerId: number;
  workerName: string;
  workerRole: string;
  checkIn: string;
  checkOut: string | null;
  source: string;
  locationName: string;
};

type MemberOption = { id: number; firstname: string; lastname: string };
type WorkerOption = { id: number; firstname: string; lastname: string; role: string };
type LocationOption = { id: number; name: string };

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayStr() {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

export default function AttendancePage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<"member" | "staff">(() => {
    return searchParams.get("tab") === "staff" ? "staff" : "member";
  });
  const [date, setDate] = useState(() => searchParams.get("date") ?? todayStr());
  const [locationFilter, setLocationFilter] = useState(() => searchParams.get("location") ?? "");

  const updateUrl = (params: Record<string, string>) => {
    const url = new URL(window.location.href);
    const today = todayStr();
    Object.entries(params).forEach(([k, v]) => {
      const isDefault =
        (k === "tab" && v === "member") ||
        (k === "date" && v === today) ||
        (k === "location" && v === "");
      if (v && !isDefault) {
        url.searchParams.set(k, v);
      } else {
        url.searchParams.delete(k);
      }
    });
    router.replace(url.pathname + url.search, { scroll: false });
  };
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [workerRows, setWorkerRows] = useState<WorkerAttendanceRow[]>([]);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberResults, setMemberResults] = useState<{ id: number; firstname: string; lastname: string; email: string; phone: string | null }[]>([]);
  const [selectedMember, setSelectedMember] = useState<{ id: number; firstname: string; lastname: string } | null>(null);
  const [checkInMemberId, setCheckInMemberId] = useState("");
  const [checkInWorkerId, setCheckInWorkerId] = useState("");
  const [checkInLocationId, setCheckInLocationId] = useState("");
  const [checkInResult, setCheckInResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [sortField, setSortField] = useState<"member" | "checkIn" | "location">("checkIn");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [staffSortField, setStaffSortField] = useState<"worker" | "checkIn" | "location">("checkIn");
  const [staffSortDir, setStaffSortDir] = useState<"asc" | "desc">("desc");

  const loadMemberAttendance = () => {
    startTransition(async () => {
      const locId = locationFilter ? parseInt(locationFilter, 10) : undefined;
      const data = await getDailyAttendance(date, locId);
      setRows(data);
    });
  };

  const loadWorkerAttendance = () => {
    startTransition(async () => {
      const locId = locationFilter ? parseInt(locationFilter, 10) : undefined;
      const data = await getWorkerDailyAttendance(date, locId);
      setWorkerRows(data);
    });
  };

  useEffect(() => {
    startTransition(async () => {
      const [l, w] = await Promise.all([
        getAttendanceLocations(),
        getWorkersList(),
      ]);
      setLocations(l);
      setWorkers(w);
      if (l.length > 0) setCheckInLocationId(String(l[0].id));
      if (l.length === 1) setLocationFilter(String(l[0].id));
    });
  }, []);

  // Debounced member search
  useEffect(() => {
    if (memberSearch.length < 2) { setMemberResults([]); return; }
    const timer = setTimeout(async () => {
      const data = await searchMembers(memberSearch);
      setMemberResults(data);
    }, 300);
    return () => clearTimeout(timer);
  }, [memberSearch]);

  useEffect(() => {
    if (tab === "member") loadMemberAttendance();
    else loadWorkerAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, locationFilter, tab]);

  const handleMemberCheckIn = () => {
    if (!checkInMemberId || !checkInLocationId) return;
    startTransition(async () => {
      const res = await manualCheckIn(
        parseInt(checkInMemberId, 10),
        parseInt(checkInLocationId, 10)
      );
      if (res.success) {
        setCheckInResult(
          "existing" in res && res.existing
            ? "Already checked in today"
            : "Check-in recorded"
        );
        loadMemberAttendance();
      } else {
        setCheckInResult("error" in res ? res.error ?? "Error" : "Error");
      }
    });
  };

  const handleWorkerCheckIn = () => {
    if (!checkInWorkerId || !checkInLocationId) return;
    startTransition(async () => {
      const res = await workerCheckIn(
        parseInt(checkInWorkerId, 10),
        parseInt(checkInLocationId, 10)
      );
      if (res.success) {
        setCheckInResult(
          "existing" in res && res.existing
            ? "Already checked in today"
            : "Check-in recorded"
        );
        loadWorkerAttendance();
      } else {
        setCheckInResult("error" in res ? res.error ?? "Error" : "Error");
      }
    });
  };

  const handleWorkerCheckOut = (attendanceId: number) => {
    startTransition(async () => {
      const res = await workerCheckOut(attendanceId);
      if (res.success) {
        setCheckInResult("Check-out recorded");
        loadWorkerAttendance();
      } else {
        setCheckInResult("error" in res ? res.error ?? "Error" : "Error");
      }
    });
  };

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const toggleStaffSort = (field: typeof staffSortField) => {
    if (staffSortField === field) setStaffSortDir(d => d === "asc" ? "desc" : "asc");
    else { setStaffSortField(field); setStaffSortDir("asc"); }
  };

  const sortedRows = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortField === "member") cmp = a.memberName.localeCompare(b.memberName);
    else if (sortField === "checkIn") cmp = new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime();
    else if (sortField === "location") cmp = a.locationName.localeCompare(b.locationName);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const sortedWorkerRows = [...workerRows].sort((a, b) => {
    let cmp = 0;
    if (staffSortField === "worker") cmp = a.workerName.localeCompare(b.workerName);
    else if (staffSortField === "checkIn") cmp = new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime();
    else if (staffSortField === "location") cmp = a.locationName.localeCompare(b.locationName);
    return staffSortDir === "asc" ? cmp : -cmp;
  });

  const handleExport = () => {
    if (tab === "member") {
      const headers = ["Member", "Check-in", "Check-out", "Source", "Location"];
      const rows = sortedRows.map((r) => [
        r.memberName,
        formatTime(r.checkIn),
        r.checkOut ? formatTime(r.checkOut) : "",
        r.source,
        r.locationName,
      ]);
      const csv = toCsv(headers, rows);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance-members-${date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const headers = ["Worker", "Role", "Check-in", "Check-out", "Source", "Location"];
      const rows = sortedWorkerRows.map((r) => [
        r.workerName,
        r.workerRole,
        formatTime(r.checkIn),
        r.checkOut ? formatTime(r.checkOut) : "",
        r.source,
        r.locationName,
      ]);
      const csv = toCsv(headers, rows);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance-staff-${date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const SortIcon = ({ field, current, dir }: { field: string; current: string; dir: "asc" | "desc" }) =>
    field === current ? (dir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />) : null;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Attendance</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => { setTab("member"); setCheckInResult(null); updateUrl({ tab: "member", date, location: locationFilter }); }}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "member"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Member Attendance
        </button>
        <button
          onClick={() => { setTab("staff"); setCheckInResult(null); updateUrl({ tab: "staff", date, location: locationFilter }); }}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "staff"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Staff Attendance
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 sm:items-end sm:flex-wrap">
        <div className="space-y-1">
          <Label>Date</Label>
          <DateQuickSelect value={date} onChange={(d) => { setDate(d); updateUrl({ tab, date: d, location: locationFilter }); }} />
        </div>
        {locations.length > 1 ? (
          <div className="space-y-1">
            <Label htmlFor="att-loc">Location</Label>
            <select
              id="att-loc"
              value={locationFilter}
              onChange={(e) => { setLocationFilter(e.target.value); updateUrl({ tab, date, location: e.target.value }); }}
              className="flex h-8 w-44 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={String(l.id)}>{l.name}</option>
              ))}
            </select>
          </div>
        ) : locations.length === 1 ? (
          <div className="space-y-1">
            <Label>Location</Label>
            <span className="flex h-8 items-center text-sm text-muted-foreground">{locations[0].name}</span>
          </div>
        ) : null}
        <Button variant="outline" size="sm" onClick={handleExport} disabled={(tab === "member" ? rows.length : workerRows.length) === 0} className="self-end">
          <Download className="size-4" />
          Export
        </Button>
      </div>

      {/* Member Attendance Tab */}
      {tab === "member" && (
        <>
          <div className="flex flex-wrap gap-2 sm:gap-4">
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Total check-ins:</span>
              <span className="font-semibold">{rows.length}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Still in gym:</span>
              <span className="font-semibold">{rows.filter(r => !r.checkOut).length}</span>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("member")}>
                    Member <SortIcon field="member" current={sortField} dir={sortDir} />
                  </button>
                </TableHead>
                <TableHead>
                  <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("checkIn")}>
                    Check-in <SortIcon field="checkIn" current={sortField} dir={sortDir} />
                  </button>
                </TableHead>
                <TableHead className="hidden md:table-cell">Check-out</TableHead>
                <TableHead className="hidden md:table-cell">Source</TableHead>
                <TableHead className="hidden md:table-cell">
                  <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort("location")}>
                    Location <SortIcon field="location" current={sortField} dir={sortDir} />
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.memberName}</TableCell>
                  <TableCell>{formatTime(r.checkIn)}</TableCell>
                  <TableCell className="hidden md:table-cell">{r.checkOut ? formatTime(r.checkOut) : "-"}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant="secondary">{r.source}</Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{r.locationName}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <div className="flex flex-col items-center gap-2 py-8">
                      <Calendar className="size-8 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">No attendance records</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <Card className="max-w-md">
            <CardHeader>
              <CardTitle>Manual Check-in</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Member</Label>
                {selectedMember ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {selectedMember.firstname} {selectedMember.lastname}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => { setSelectedMember(null); setCheckInMemberId(""); setCheckInResult(null); }}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      placeholder="Search by name, email, or phone..."
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      autoFocus
                    />
                    {memberResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full border rounded-md bg-popover divide-y max-h-40 overflow-y-auto shadow-md">
                        {memberResults.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                            onClick={() => {
                              setSelectedMember(m);
                              setCheckInMemberId(String(m.id));
                              setMemberSearch("");
                              setMemberResults([]);
                            }}
                          >
                            {m.firstname} {m.lastname}
                            {m.phone ? ` (${m.phone})` : ""}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="ci-loc">Location</Label>
                <select
                  id="ci-loc"
                  value={checkInLocationId}
                  onChange={(e) => setCheckInLocationId(e.target.value)}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
                >
                  {locations.map((l) => (
                    <option key={l.id} value={String(l.id)}>{l.name}</option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                onClick={handleMemberCheckIn}
                disabled={isPending || !checkInMemberId}
              >
                {isPending && <Loader2 className="size-4 animate-spin" />}
                {isPending ? "Processing..." : "Check In"}
              </Button>
              {checkInResult && (
                <p className="text-sm text-muted-foreground">{checkInResult}</p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Staff Attendance Tab */}
      {tab === "staff" && (
        <>
          <div className="flex flex-wrap gap-2 sm:gap-4">
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Total check-ins:</span>
              <span className="font-semibold">{workerRows.length}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Still in gym:</span>
              <span className="font-semibold">{workerRows.filter(r => !r.checkOut).length}</span>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleStaffSort("worker")}>
                    Worker <SortIcon field="worker" current={staffSortField} dir={staffSortDir} />
                  </button>
                </TableHead>
                <TableHead className="hidden md:table-cell">Role</TableHead>
                <TableHead>
                  <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleStaffSort("checkIn")}>
                    Check-in <SortIcon field="checkIn" current={staffSortField} dir={staffSortDir} />
                  </button>
                </TableHead>
                <TableHead className="hidden md:table-cell">Check-out</TableHead>
                <TableHead className="hidden md:table-cell">Source</TableHead>
                <TableHead className="hidden md:table-cell">
                  <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleStaffSort("location")}>
                    Location <SortIcon field="location" current={staffSortField} dir={staffSortDir} />
                  </button>
                </TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedWorkerRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.workerName}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant="secondary">{r.workerRole}</Badge>
                  </TableCell>
                  <TableCell>{formatTime(r.checkIn)}</TableCell>
                  <TableCell className="hidden md:table-cell">{r.checkOut ? formatTime(r.checkOut) : "-"}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant="secondary">{r.source}</Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{r.locationName}</TableCell>
                  <TableCell>
                    {!r.checkOut && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleWorkerCheckOut(r.id)}
                        disabled={isPending}
                      >
                        Check Out
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {workerRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className="flex flex-col items-center gap-2 py-8">
                      <Calendar className="size-8 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">No staff attendance records</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <Card className="max-w-md">
            <CardHeader>
              <CardTitle>Staff Check-in</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="ci-worker">Worker</Label>
                <select
                  id="ci-worker"
                  value={checkInWorkerId}
                  onChange={(e) => setCheckInWorkerId(e.target.value)}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
                >
                  <option value="">Select worker...</option>
                  {workers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.firstname} {w.lastname} ({w.role})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ci-loc-w">Location</Label>
                <select
                  id="ci-loc-w"
                  value={checkInLocationId}
                  onChange={(e) => setCheckInLocationId(e.target.value)}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm"
                >
                  {locations.map((l) => (
                    <option key={l.id} value={String(l.id)}>{l.name}</option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                onClick={handleWorkerCheckIn}
                disabled={isPending || !checkInWorkerId}
              >
                {isPending && <Loader2 className="size-4 animate-spin" />}
                {isPending ? "Processing..." : "Check In"}
              </Button>
              {checkInResult && (
                <p className="text-sm text-muted-foreground">{checkInResult}</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
