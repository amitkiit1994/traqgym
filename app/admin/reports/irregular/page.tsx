"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { getIrregularMembersReport } from "@/lib/actions/reports";
import { getLocations } from "@/lib/actions/locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type LocationOption = { id: number; name: string; isActive: boolean };
type IrregularRow = Awaited<ReturnType<typeof getIrregularMembersReport>>[number];

function fmt(date: string) {
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function IrregularMembersPage() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [daysThreshold, setDaysThreshold] = useState(7);
  const [rows, setRows] = useState<IrregularRow[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    getLocations().then((locs) => {
      setLocations(locs.filter((l) => l.isActive));
      if (locs.filter((l) => l.isActive).length === 1) {
        setLocationId(String(locs.filter((l) => l.isActive)[0].id));
      }
    });
  }, []);

  const load = () => {
    startTransition(async () => {
      const data = await getIrregularMembersReport(
        daysThreshold,
        locationId ? parseInt(locationId, 10) : undefined
      );
      setRows(data);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const statusBadge = (row: IrregularRow) => {
    if (row.daysSinceLastVisit === null) {
      return <Badge variant="destructive">Never visited</Badge>;
    }
    if (row.daysSinceLastVisit >= 14) {
      return <Badge variant="destructive">Absent</Badge>;
    }
    return <Badge variant="secondary">Irregular</Badge>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/reports" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Reports
        </Link>
        <h1 className="text-xl font-semibold">Irregular Members Report</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Days Threshold</Label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={30}
                  value={daysThreshold}
                  onChange={(e) => setDaysThreshold(parseInt(e.target.value, 10))}
                  className="w-32"
                />
                <Input
                  type="number"
                  min={1}
                  max={90}
                  value={daysThreshold}
                  onChange={(e) => setDaysThreshold(parseInt(e.target.value, 10) || 7)}
                  className="w-16"
                />
                <span className="text-sm text-muted-foreground">days</span>
              </div>
            </div>
            {locations.length > 1 && (
              <div>
                <Label>Location</Label>
                <Select value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder="All locations">
                      {locationId ? locations.find((l) => String(l.id) === locationId)?.name ?? "All Locations" : "All Locations"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Locations</SelectItem>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {locations.length === 1 && (
              <div>
                <Label>Location</Label>
                <span className="flex h-9 items-center text-sm text-muted-foreground">{locations[0].name}</span>
              </div>
            )}
            <Button onClick={load} disabled={isPending}>Load</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="hidden md:table-cell">Last Visit</TableHead>
                <TableHead className="text-right">Days Since</TableHead>
                <TableHead className="hidden md:table-cell">Plan</TableHead>
                <TableHead className="hidden md:table-cell">Expiry</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{r.phone}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {r.lastCheckIn ? fmt(r.lastCheckIn) : "-"}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.daysSinceLastVisit ?? "Never"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{r.activePlan}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {r.planExpiry ? fmt(r.planExpiry) : "-"}
                  </TableCell>
                  <TableCell>{statusBadge(r)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No irregular members found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {rows.length > 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              {rows.length} member{rows.length !== 1 ? "s" : ""} absent for {daysThreshold}+ days
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
