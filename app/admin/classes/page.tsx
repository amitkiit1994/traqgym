"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  getClassesAction,
  createClassAction,
  updateClassAction,
  toggleClassActiveAction,
} from "@/lib/actions/classes";
import {
  getAttendancePatternsAction,
  suggestScheduleAction,
} from "@/lib/actions/smart-scheduling";
import { getLocations } from "@/lib/actions/locations";
import { getWorkers } from "@/lib/actions/workers";
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
import { CalendarDays, Brain, Loader2 } from "lucide-react";

const CLASS_TYPES = ["group", "personal_training", "workshop"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS_RANGE = Array.from({ length: 18 }, (_, i) => i + 6); // 6AM to 11PM

type Schedule = { dayOfWeek: number; startTime: string; endTime: string };

type ClassItem = {
  id: number;
  name: string;
  description: string | null;
  classType: string;
  instructorId: number | null;
  instructorName: string | null;
  locationId: number;
  locationName: string;
  maxCapacity: number;
  isActive: boolean;
  schedules: (Schedule & { id: number })[];
  bookingCount: number;
};

type Loc = { id: number; name: string };
type Worker = { id: number; firstname: string; lastname: string; role: string; isActive: boolean };

type HeatmapCell = { dayOfWeek: number; hour: number; count: number };

type PatternsData = {
  heatmap: HeatmapCell[];
  peakHours: { hour: number; avgCount: number }[];
  peakDays: { dayOfWeek: number; avgCount: number }[];
  totalCheckins: number;
  dateRange: { from: string; to: string };
};

export default function ClassesPage() {
  const [tab, setTab] = useState<"classes" | "insights">("classes");
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [locations, setLocations] = useState<Loc[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClassItem | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  // Smart Insights state
  const [insightLocationId, setInsightLocationId] = useState<number | undefined>();
  const [patterns, setPatterns] = useState<PatternsData | null>(null);
  const [suggestions, setSuggestions] = useState<{ patterns: string; suggestions: string[] } | null>(null);
  const [loadingPatterns, setLoadingPatterns] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const load = () => {
    startTransition(async () => {
      const [cls, locs, wks] = await Promise.all([
        getClassesAction(),
        getLocations(),
        getWorkers(),
      ]);
      setClasses(cls);
      setLocations(locs);
      setWorkers(wks);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing(null);
    setSchedules([{ dayOfWeek: 1, startTime: "07:00", endTime: "08:00" }]);
    setError("");
    setDialogOpen(true);
  };

  const openEdit = (item: ClassItem) => {
    setEditing(item);
    setSchedules(
      item.schedules.map((s) => ({
        dayOfWeek: s.dayOfWeek,
        startTime: s.startTime,
        endTime: s.endTime,
      }))
    );
    setError("");
    setDialogOpen(true);
  };

  const addScheduleRow = () => {
    setSchedules((prev) => [
      ...prev,
      { dayOfWeek: 1, startTime: "07:00", endTime: "08:00" },
    ]);
  };

  const removeScheduleRow = (index: number) => {
    setSchedules((prev) => prev.filter((_, i) => i !== index));
  };

  const updateScheduleRow = (
    index: number,
    field: keyof Schedule,
    value: string | number
  ) => {
    setSchedules((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      name: fd.get("name") as string,
      description: (fd.get("description") as string) || undefined,
      classType: fd.get("classType") as string,
      instructorId: fd.get("instructorId")
        ? Number(fd.get("instructorId"))
        : undefined,
      locationId: Number(fd.get("locationId")),
      maxCapacity: Number(fd.get("maxCapacity")) || 20,
      schedules,
    };

    startTransition(async () => {
      const result = editing
        ? await updateClassAction(editing.id, data)
        : await createClassAction(data);
      if ("error" in result) {
        setError(result.error || "Failed to save");
      } else {
        setDialogOpen(false);
        load();
      }
    });
  };

  const handleToggle = (id: number) => {
    startTransition(async () => {
      await toggleClassActiveAction(id);
      load();
    });
  };

  const formatSchedule = (scheds: Schedule[]) => {
    return scheds
      .map((s) => `${DAYS[s.dayOfWeek]} ${s.startTime}-${s.endTime}`)
      .join(", ");
  };

  const loadPatterns = async () => {
    setLoadingPatterns(true);
    const result = await getAttendancePatternsAction(insightLocationId);
    if ("error" in result) {
      setPatterns(null);
    } else {
      setPatterns(result as PatternsData);
    }
    setLoadingPatterns(false);
  };

  const loadSuggestions = async () => {
    setLoadingSuggestions(true);
    const result = await suggestScheduleAction(insightLocationId);
    if ("error" in result) {
      setSuggestions(null);
    } else {
      setSuggestions(result as { patterns: string; suggestions: string[] });
    }
    setLoadingSuggestions(false);
  };

  // Build heatmap grid data
  const getHeatmapValue = (dayOfWeek: number, hour: number): number => {
    if (!patterns) return 0;
    const cell = patterns.heatmap.find(
      (c) => c.dayOfWeek === dayOfWeek && c.hour === hour
    );
    return cell?.count ?? 0;
  };

  const maxHeatmapCount = patterns
    ? Math.max(...patterns.heatmap.map((c) => c.count), 1)
    : 1;

  const heatmapColor = (count: number): string => {
    if (count === 0) return "transparent";
    const intensity = Math.round((count / maxHeatmapCount) * 100);
    // Use primary color with varying opacity
    if (intensity <= 20) return "oklch(0.65 0.20 25 / 0.15)";
    if (intensity <= 40) return "oklch(0.65 0.20 25 / 0.30)";
    if (intensity <= 60) return "oklch(0.65 0.20 25 / 0.50)";
    if (intensity <= 80) return "oklch(0.65 0.20 25 / 0.70)";
    return "oklch(0.65 0.20 25 / 0.90)";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Classes</h1>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-border p-0.5">
            <button
              onClick={() => setTab("classes")}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                tab === "classes"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Classes
            </button>
            <button
              onClick={() => setTab("insights")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                tab === "insights"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Brain className="size-3.5" />
              Smart Insights
            </button>
          </div>
          {tab === "classes" && (
            <Button onClick={openCreate}>New Class</Button>
          )}
        </div>
      </div>

      {tab === "classes" && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="hidden md:table-cell">Location</TableHead>
                <TableHead className="hidden md:table-cell">Instructor</TableHead>
                <TableHead className="hidden lg:table-cell">Capacity</TableHead>
                <TableHead className="hidden lg:table-cell">Schedule</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/classes/${c.id}`}
                      className="text-primary hover:underline"
                    >
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {c.classType.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{c.locationName}</TableCell>
                  <TableCell className="hidden md:table-cell">{c.instructorName || "-"}</TableCell>
                  <TableCell className="hidden lg:table-cell">{c.maxCapacity}</TableCell>
                  <TableCell className="hidden lg:table-cell text-xs max-w-48 truncate">
                    {formatSchedule(c.schedules)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={c.isActive ? "active" : "expired"}
                    >
                      {c.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(c)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggle(c.id)}
                      >
                        {c.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {classes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <div className="flex flex-col items-center gap-2 py-8">
                      <CalendarDays className="size-8 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">No classes found</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </>
      )}

      {tab === "insights" && (
        <div className="space-y-6">
          {/* Controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-48">
              <Label htmlFor="insightLocation">Location</Label>
              <select
                id="insightLocation"
                value={insightLocationId ?? ""}
                onChange={(e) =>
                  setInsightLocationId(
                    e.target.value ? Number(e.target.value) : undefined
                  )
                }
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={loadPatterns} disabled={loadingPatterns}>
              {loadingPatterns && <Loader2 className="mr-2 size-4 animate-spin" />}
              Load Heatmap
            </Button>
            <Button
              onClick={loadSuggestions}
              disabled={loadingSuggestions}
              variant="outline"
            >
              {loadingSuggestions && <Loader2 className="mr-2 size-4 animate-spin" />}
              <Brain className="mr-2 size-4" />
              Analyze & Suggest
            </Button>
          </div>

          {/* Empty state */}
          {!patterns && !suggestions && !loadingPatterns && !loadingSuggestions && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Brain className="size-10 text-muted-foreground/40" />
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  No insights loaded yet
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Click &quot;Load Heatmap&quot; to view attendance patterns, or &quot;Analyze &amp; Suggest&quot; for AI-powered scheduling recommendations.
                </p>
              </div>
            </div>
          )}

          {/* Heatmap */}
          {patterns && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  Attendance Heatmap (last 30 days)
                </h2>
                <p className="text-xs text-muted-foreground">
                  {patterns.totalCheckins} total check-ins
                </p>
              </div>

              {patterns.totalCheckins === 0 ? (
                <div className="rounded-lg border border-border p-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    No attendance data for the selected period.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border p-3">
                  <div className="min-w-[600px]">
                    {/* Hour labels */}
                    <div className="grid gap-px" style={{ gridTemplateColumns: "48px repeat(18, 1fr)" }}>
                      <div />
                      {HOURS_RANGE.map((h) => (
                        <div
                          key={h}
                          className="text-center text-[10px] text-muted-foreground pb-1"
                        >
                          {h}:00
                        </div>
                      ))}
                    </div>

                    {/* Rows: one per day */}
                    {DAYS.map((dayName, dayIdx) => (
                      <div
                        key={dayIdx}
                        className="grid gap-px"
                        style={{ gridTemplateColumns: "48px repeat(18, 1fr)" }}
                      >
                        <div className="flex items-center text-xs font-medium text-muted-foreground pr-2">
                          {dayName}
                        </div>
                        {HOURS_RANGE.map((hour) => {
                          const count = getHeatmapValue(dayIdx, hour);
                          return (
                            <div
                              key={hour}
                              className="aspect-square rounded-sm border border-border/30 flex items-center justify-center text-[9px] cursor-default"
                              style={{ backgroundColor: heatmapColor(count) }}
                              title={`${dayName} ${hour}:00 — ${count} check-ins`}
                            >
                              {count > 0 ? count : ""}
                            </div>
                          );
                        })}
                      </div>
                    ))}

                    {/* Legend */}
                    <div className="flex items-center gap-2 mt-3 justify-end">
                      <span className="text-[10px] text-muted-foreground">Less</span>
                      {[0.15, 0.3, 0.5, 0.7, 0.9].map((opacity) => (
                        <div
                          key={opacity}
                          className="size-3 rounded-sm border border-border/30"
                          style={{
                            backgroundColor: `oklch(0.65 0.20 25 / ${opacity})`,
                          }}
                        />
                      ))}
                      <span className="text-[10px] text-muted-foreground">More</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Peak summary cards */}
              {patterns.totalCheckins > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Peak Hours
                    </h3>
                    {patterns.peakHours.slice(0, 5).map((h) => (
                      <div key={h.hour} className="flex items-center justify-between text-sm">
                        <span>{h.hour}:00</span>
                        <span className="text-muted-foreground">
                          avg {h.avgCount} check-ins
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Peak Days
                    </h3>
                    {patterns.peakDays.slice(0, 5).map((d) => (
                      <div key={d.dayOfWeek} className="flex items-center justify-between text-sm">
                        <span>{DAYS[d.dayOfWeek]}</span>
                        <span className="text-muted-foreground">
                          avg {d.avgCount} check-ins
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AI Suggestions */}
          {suggestions && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Brain className="size-4" />
                AI Scheduling Suggestions
              </h2>

              {suggestions.patterns && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-sm text-muted-foreground">{suggestions.patterns}</p>
                </div>
              )}

              <div className="space-y-2">
                {suggestions.suggestions.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-border p-3 flex gap-3 items-start"
                  >
                    <span className="flex-none size-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <p className="text-sm">{s}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Class" : "New Class"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <div>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={editing?.name ?? ""}
                key={editing?.id ?? "new"}
                required
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                name="description"
                defaultValue={editing?.description ?? ""}
                key={`desc-${editing?.id ?? "new"}`}
              />
            </div>
            <div>
              <Label htmlFor="classType">Type</Label>
              <select
                id="classType"
                name="classType"
                defaultValue={editing?.classType ?? "group"}
                key={`ct-${editing?.id ?? "new"}`}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                {CLASS_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="locationId">Location</Label>
              <select
                id="locationId"
                name="locationId"
                defaultValue={editing?.locationId ?? ""}
                key={`loc-${editing?.id ?? "new"}`}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                required
              >
                <option value="">Select...</option>
                {locations.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="instructorId">Instructor</Label>
              <select
                id="instructorId"
                name="instructorId"
                defaultValue={editing?.instructorId ?? ""}
                key={`ins-${editing?.id ?? "new"}`}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">None</option>
                {workers
                  .filter((w) => w.isActive)
                  .map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.firstname} {w.lastname} ({w.role})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label htmlFor="maxCapacity">Max Capacity</Label>
              <Input
                id="maxCapacity"
                name="maxCapacity"
                type="number"
                min={1}
                defaultValue={editing?.maxCapacity ?? 20}
                key={`cap-${editing?.id ?? "new"}`}
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Schedules</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addScheduleRow}
                >
                  Add Schedule
                </Button>
              </div>
              {schedules.map((s, i) => (
                <div key={i} className="flex gap-2 items-end">
                  <div className="flex-1">
                    <select
                      value={s.dayOfWeek}
                      onChange={(e) =>
                        updateScheduleRow(i, "dayOfWeek", Number(e.target.value))
                      }
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                    >
                      {DAYS.map((d, idx) => (
                        <option key={idx} value={idx}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Input
                      type="time"
                      value={s.startTime}
                      onChange={(e) =>
                        updateScheduleRow(i, "startTime", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <Input
                      type="time"
                      value={s.endTime}
                      onChange={(e) =>
                        updateScheduleRow(i, "endTime", e.target.value)
                      }
                    />
                  </div>
                  {schedules.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeScheduleRow(i)}
                    >
                      X
                    </Button>
                  )}
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {editing ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
