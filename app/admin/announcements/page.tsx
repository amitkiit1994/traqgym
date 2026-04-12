"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getAllAnnouncements,
  createAnnouncement,
  toggleAnnouncement,
} from "@/lib/actions/announcements";
import { getLocations } from "@/lib/actions/locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

type Announcement = {
  id: number;
  title: string;
  content: string;
  priority: string;
  targetGroup: string;
  locationId: number | null;
  locationName: string;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
};

type Location = { id: number; name: string; code: string; address: string | null; phone: string | null; isActive: boolean; createdAt: Date };

const PRIORITIES = ["low", "normal", "high", "urgent"];
const TARGET_GROUPS = ["all", "members", "staff"];

function priorityVariant(p: string): "default" | "secondary" | "destructive" | "outline" {
  switch (p) {
    case "urgent":
      return "destructive";
    case "high":
      return "default";
    case "normal":
      return "secondary";
    default:
      return "outline";
  }
}

function priorityColor(p: string): string {
  switch (p) {
    case "urgent":
      return "bg-status-expired-bg text-status-expired-foreground border-status-expired/30";
    case "high":
      return "bg-status-expiring-bg text-status-expiring-foreground border-status-expiring/30";
    case "normal":
      return "bg-status-info-bg text-status-info-foreground border-status-info/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  const load = () => {
    startTransition(async () => {
      const [data, locs] = await Promise.all([
        getAllAnnouncements(),
        getLocations(),
      ]);
      setAnnouncements(data);
      setLocations(locs);
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = {
      title: fd.get("title") as string,
      content: fd.get("content") as string,
      priority: fd.get("priority") as string,
      targetGroup: fd.get("targetGroup") as string,
      locationId: fd.get("locationId") ? Number(fd.get("locationId")) : undefined,
      expiresAt: (fd.get("expiresAt") as string) || undefined,
    };

    startTransition(async () => {
      const result = await createAnnouncement(data);
      if (result.errors) {
        setErrors(result.errors);
      } else {
        setDialogOpen(false);
        setErrors({});
        load();
      }
    });
  };

  const handleToggle = (id: number) => {
    startTransition(async () => {
      await toggleAnnouncement(id);
      load();
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl md:text-2xl font-semibold">Announcements</h1>
        <Button onClick={() => { setErrors({}); setDialogOpen(true); }}>
          New Announcement
        </Button>
      </div>

      <div className="grid gap-4">
        {announcements.map((a) => (
          <Card key={a.id} className={!a.isActive ? "opacity-50" : ""}>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between space-y-0 pb-2">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">{a.title}</CardTitle>
                <Badge className={priorityColor(a.priority)}>
                  {a.priority}
                </Badge>
                <Badge variant="outline">{a.targetGroup}</Badge>
                {!a.isActive && <Badge variant="secondary">Inactive</Badge>}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleToggle(a.id)}
                disabled={isPending}
              >
                {a.isActive ? "Deactivate" : "Activate"}
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{a.content}</p>
              <div className="mt-2 flex flex-wrap gap-2 sm:gap-4 text-xs text-muted-foreground">
                <span>Location: {a.locationName}</span>
                <span>
                  Created: {new Date(a.createdAt).toLocaleDateString("en-IN")}
                </span>
                {a.expiresAt && (
                  <span>
                    Expires: {new Date(a.expiresAt).toLocaleDateString("en-IN")}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {announcements.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No announcements yet
          </p>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Announcement</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" />
              {errors.title && (
                <p className="text-xs text-destructive mt-1">{errors.title}</p>
              )}
            </div>
            <div>
              <Label htmlFor="content">Content</Label>
              <textarea
                id="content"
                name="content"
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              />
              {errors.content && (
                <p className="text-xs text-destructive mt-1">{errors.content}</p>
              )}
            </div>
            <div>
              <Label htmlFor="priority">Priority</Label>
              <select
                id="priority"
                name="priority"
                defaultValue="normal"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="targetGroup">Target Group</Label>
              <select
                id="targetGroup"
                name="targetGroup"
                defaultValue="all"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                {TARGET_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="locationId">Location</Label>
              <select
                id="locationId"
                name="locationId"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="">All Locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="expiresAt">Expires At (optional)</Label>
              <Input id="expiresAt" name="expiresAt" type="datetime-local" />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
