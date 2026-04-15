"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { getConversionFunnelReport } from "@/lib/actions/reports";
import { getLocations } from "@/lib/actions/locations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";

type LocationOption = { id: number; name: string; isActive: boolean };
type FunnelData = Awaited<ReturnType<typeof getConversionFunnelReport>>;

const STAGE_COLORS: Record<string, string> = {
  new: "#6366f1",
  contacted: "#8b5cf6",
  tour_scheduled: "#a78bfa",
  tour_done: "#22c55e",
  trial: "#14b8a6",
  negotiation: "#f59e0b",
  converted: "#10b981",
  lost: "#ef4444",
};

const STAGE_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  tour_scheduled: "Tour Scheduled",
  tour_done: "Tour Done",
  trial: "Trial",
  negotiation: "Negotiation",
  converted: "Converted",
  lost: "Lost",
};

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function thirtyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0];
}

export default function ConversionFunnelPage() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(todayStr);
  const [data, setData] = useState<FunnelData>({ stages: [], totalConversionRate: 0 });
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    getLocations().then((locs) => {
      const active = locs.filter((l) => l.isActive);
      setLocations(active);
      if (active.length === 1) setLocationId(String(active[0].id));
    });
  }, []);

  const load = () => {
    startTransition(async () => {
      const result = await getConversionFunnelReport(
        startDate || undefined,
        endDate || undefined,
        locationId ? parseInt(locationId, 10) : undefined
      );
      setData(result);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const chartData = data.stages.map((s) => ({
    stage: STAGE_LABELS[s.stage] ?? s.stage,
    count: s.count,
    fill: STAGE_COLORS[s.stage] ?? "#6366f1",
  }));

  const maxCount = Math.max(...data.stages.map((s) => s.count), 1);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/reports" className="text-sm text-muted-foreground hover:text-foreground">
          &larr; Reports
        </Link>
        <h1 className="text-xl font-semibold">Conversion Funnel</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full sm:w-40" />
            </div>
            <div>
              <Label>End Date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full sm:w-40" />
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

      {data.stages.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Total Conversion Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{data.totalConversionRate}%</p>
                <p className="text-xs text-muted-foreground">New to Converted</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Total Enquiries</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {data.stages.reduce((s, st) => s + st.count, 0)}
                </p>
                <p className="text-xs text-muted-foreground">Across all stages</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Funnel Visualization</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, maxCount]}
                      stroke="var(--color-muted-foreground)"
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="stage"
                      width={110}
                      stroke="var(--color-muted-foreground)"
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "0.5rem",
                        color: "var(--color-foreground)",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                      }}
                      itemStyle={{ color: "var(--color-foreground)" }}
                      labelStyle={{ color: "var(--color-muted-foreground)", fontWeight: 600 }}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {chartData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                      <LabelList dataKey="count" position="right" fill="var(--color-muted-foreground)" fontSize={11} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Stage Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Conversion Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.stages.map((s, i) => (
                    <TableRow key={s.stage}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ backgroundColor: STAGE_COLORS[s.stage] ?? "#6366f1" }}
                          />
                          {STAGE_LABELS[s.stage] ?? s.stage}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{s.count}</TableCell>
                      <TableCell className="text-right">
                        {i === 0
                          ? "-"
                          : s.stage === "lost"
                            ? "-"
                            : `${s.conversionRate}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {data.stages.length === 0 && !isPending && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No enquiry data found for the selected filters.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
