"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import {
  getLocations,
  createLocation,
  updateLocation,
  toggleLocationActive,
  getOpeningHours,
  updateOpeningHours,
} from "@/lib/actions/locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type Location = {
  id: number;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
};

type OpeningHourRow = {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DEFAULT_HOURS: OpeningHourRow[] = Array.from({ length: 7 }, (_, i) => ({
  dayOfWeek: i,
  openTime: "06:00",
  closeTime: "22:00",
  isClosed: false,
}));

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const [hoursLocationId, setHoursLocationId] = useState<number | null>(null);
  const [hours, setHours] = useState<OpeningHourRow[]>(DEFAULT_HOURS);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursSaved, setHoursSaved] = useState(false);

  const load = () => {
    startTransition(async () => {
      const data = await getLocations();
      setLocations(data);
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

  const openEdit = (loc: Location) => {
    setEditing(loc);
    setErrors({});
    setDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      name: fd.get("name") as string,
      code: fd.get("code") as string,
      address: (fd.get("address") as string) || undefined,
      phone: (fd.get("phone") as string) || undefined,
    };

    startTransition(async () => {
      const result = editing
        ? await updateLocation(editing.id, data)
        : await createLocation(data);
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
      await toggleLocationActive(id);
      load();
    });
  };

  const toggleHoursPanel = (locationId: number) => {
    if (hoursLocationId === locationId) {
      setHoursLocationId(null);
      return;
    }
    setHoursLocationId(locationId);
    setHoursSaved(false);
    startTransition(async () => {
      const data = await getOpeningHours(locationId);
      if (data.length === 7) {
        setHours(data.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          openTime: d.openTime,
          closeTime: d.closeTime,
          isClosed: d.isClosed,
        })));
      } else {
        setHours(DEFAULT_HOURS);
      }
    });
  };

  const updateHourField = (dayOfWeek: number, field: keyof OpeningHourRow, value: string | boolean) => {
    setHours((prev) =>
      prev.map((h) => (h.dayOfWeek === dayOfWeek ? { ...h, [field]: value } : h))
    );
    setHoursSaved(false);
  };

  const saveHours = () => {
    if (!hoursLocationId) return;
    setHoursSaving(true);
    startTransition(async () => {
      await updateOpeningHours(hoursLocationId, hours);
      setHoursSaving(false);
      setHoursSaved(true);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Locations</h1>
        <Button onClick={openCreate}>Add Location</Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Address</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {locations.map((loc) => (
            <Fragment key={loc.id}>
            <TableRow>
              <TableCell>{loc.name}</TableCell>
              <TableCell>{loc.code}</TableCell>
              <TableCell>{loc.address ?? "-"}</TableCell>
              <TableCell>{loc.phone ?? "-"}</TableCell>
              <TableCell>
                <Badge variant={loc.isActive ? "default" : "secondary"}>
                  {loc.isActive ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="space-x-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(loc)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggle(loc.id)}
                  disabled={isPending}
                >
                  {loc.isActive ? "Deactivate" : "Activate"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => toggleHoursPanel(loc.id)}
                >
                  {hoursLocationId === loc.id ? "Hide Hours" : "Hours"}
                </Button>
              </TableCell>
            </TableRow>
            {hoursLocationId === loc.id && (
              <TableRow>
                <TableCell colSpan={7} className="p-0">
                  <Card className="m-4">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">Opening Hours — {loc.name}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-32">Day</TableHead>
                            <TableHead className="w-36">Open</TableHead>
                            <TableHead className="w-36">Close</TableHead>
                            <TableHead className="w-24">Closed</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {hours.map((h) => (
                            <TableRow key={h.dayOfWeek}>
                              <TableCell className="font-medium">{DAY_NAMES[h.dayOfWeek]}</TableCell>
                              <TableCell>
                                <Input
                                  type="time"
                                  value={h.openTime}
                                  disabled={h.isClosed}
                                  onChange={(e) => updateHourField(h.dayOfWeek, "openTime", e.target.value)}
                                  className="w-28"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="time"
                                  value={h.closeTime}
                                  disabled={h.isClosed}
                                  onChange={(e) => updateHourField(h.dayOfWeek, "closeTime", e.target.value)}
                                  className="w-28"
                                />
                              </TableCell>
                              <TableCell>
                                <Switch
                                  checked={h.isClosed}
                                  onCheckedChange={(v) => updateHourField(h.dayOfWeek, "isClosed", v)}
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <div className="flex items-center gap-3 mt-4">
                        <Button onClick={saveHours} disabled={hoursSaving || isPending}>
                          {hoursSaving ? "Saving..." : "Save Hours"}
                        </Button>
                        {hoursSaved && (
                          <span className="text-sm text-muted-foreground">Saved</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TableCell>
              </TableRow>
            )}
            </Fragment>
          ))}
          {locations.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground">
                No locations found
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Location" : "Add Location"}</DialogTitle>
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
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                name="code"
                defaultValue={editing?.code ?? ""}
                key={`code-${editing?.id ?? "new"}`}
              />
              {errors.code && (
                <p className="text-xs text-destructive mt-1">{errors.code}</p>
              )}
            </div>
            <div>
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                name="address"
                defaultValue={editing?.address ?? ""}
                key={`addr-${editing?.id ?? "new"}`}
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                defaultValue={editing?.phone ?? ""}
                key={`phone-${editing?.id ?? "new"}`}
              />
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
