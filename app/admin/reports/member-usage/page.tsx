"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { fetchMemberUsage } from "@/lib/actions/member-usage";
import { getLocations } from "@/lib/actions/locations";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

type LocationOption = { id: number; name: string; isActive: boolean };
type UsageData = Awaited<ReturnType<typeof fetchMemberUsage>>;

const SEGMENT_COLORS: Record<string, string> = {
  heavy: "#22c55e",
  moderate: "#f59e0b",
  light: "#ef4444",
};

const SEGMENT_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  heavy: "default",
  moderate: "secondary",
  light: "destructive",
};

export default function MemberUsagePage() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [data, setData] = useState<UsageData>({ segments: { heavy: 0, moderate: 0, light: 0 }, members: [] });
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    getLocations().then((locs) => {
      setLocations(locs.filter((l) => l.isActive));
      if (locs.length === 1) setLocationId(String(locs[0].id));
    });
  }, []);

  const load = () => {
    startTransition(async () => {
      const result = await fetchMemberUsage(
        locationId ? parseInt(locationId, 10) : undefined
      );
      setData(result);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const pieData = [
    { name: "Heavy (>70%)", value: data.segments.heavy, color: SEGMENT_COLORS.heavy },
    { name: "Moderate (30-70%)", value: data.segments.moderate, color: SEGMENT_COLORS.moderate },
    { name: "Light (<30%)", value: data.segments.light, color: SEGMENT_COLORS.light },
  ].filter((d) => d.value > 0);

  const totalMembers = data.segments.heavy + data.segments.moderate + data.segments.light;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/reports" className="text-sm text-muted-foreground hover:underline">
          Reports
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-xl font-semibold">Member Usage Analysis</h1>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        {locations.length > 1 && (
          <div>
            <Label>Location</Label>
            <Select value={locationId} onValueChange={(v) => setLocationId(v ?? "")}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All locations">
                  {locationId
                    ? locations.find((l) => String(l.id) === locationId)?.name ?? "All Locations"
                    : "All Locations"}
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
        <Button onClick={load} disabled={isPending}>
          {isPending ? "Loading..." : "Load"}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Active</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold">{totalMembers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Heavy Users (&gt;70%)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-green-600">{data.segments.heavy}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Moderate (30-70%)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-yellow-500">{data.segments.moderate}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Light (&lt;30%)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-bold text-red-500">{data.segments.light}</p>
          </CardContent>
        </Card>
      </div>

      {/* Pie Chart */}
      {pieData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Usage Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  dataKey="value"
                  nameKey="name"
                  label={({ name, percent }) => `${name}: ${((percent ?? 0) * 100).toFixed(0)}%`}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Members Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Member Details (sorted by usage, lowest first)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead className="text-right">Visits</TableHead>
                <TableHead className="text-right hidden md:table-cell">Days Active</TableHead>
                <TableHead className="text-right">Usage %</TableHead>
                <TableHead>Segment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>{m.phone}</TableCell>
                  <TableCell>{m.plan}</TableCell>
                  <TableCell className="text-right">{m.totalVisits}</TableCell>
                  <TableCell className="text-right hidden md:table-cell">{m.membershipDays}</TableCell>
                  <TableCell className="text-right">{m.usagePercent}%</TableCell>
                  <TableCell>
                    <Badge variant={SEGMENT_VARIANT[m.segment]}>{m.segment}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {data.members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No active members found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
