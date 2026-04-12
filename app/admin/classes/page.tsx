"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  getClassesAction,
  createClassAction,
  updateClassAction,
  toggleClassActiveAction,
} from "@/lib/actions/classes";
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
import { CalendarDays } from "lucide-react";

const CLASS_TYPES = ["group", "personal_training", "workshop"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

export default function ClassesPage() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [locations, setLocations] = useState<Loc[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClassItem | null>(null);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Classes</h1>
        <Button onClick={openCreate}>New Class</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Instructor</TableHead>
            <TableHead>Capacity</TableHead>
            <TableHead>Schedule</TableHead>
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
              <TableCell>{c.locationName}</TableCell>
              <TableCell>{c.instructorName || "-"}</TableCell>
              <TableCell>{c.maxCapacity}</TableCell>
              <TableCell className="text-xs max-w-48 truncate">
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
