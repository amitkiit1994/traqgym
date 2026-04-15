"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { fetchKPIData } from "@/lib/actions/kpi-dashboard";
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
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type LocationOption = { id: number; name: string; isActive: boolean };
type MonthKPI = Awaited<ReturnType<typeof fetchKPIData>>[number];

function TrendArrow({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) return <span className="text-xs text-muted-foreground">--</span>;
  const diff = previous === 0 ? 100 : Math.round(((current - previous) / previous) * 100);
  if (diff > 0) return <span className="text-xs text-green-500">+{diff}%</span>;
  if (diff < 0) return <span className="text-xs text-red-500">{diff}%</span>;
  return <span className="text-xs text-muted-foreground">0%</span>;
}

export default function KPIDashboardPage() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [period, setPeriod] = useState("6");
  const [data, setData] = useState<MonthKPI[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    getLocations().then((locs) => {
      setLocations(locs.filter((l) => l.isActive));
      if (locs.length === 1) setLocationId(String(locs[0].id));
    });
  }, []);

  const load = () => {
    startTransition(async () => {
      const result = await fetchKPIData(
        parseInt(period, 10),
        locationId ? parseInt(locationId, 10) : undefined
      );
      setData(result);
    });
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const current = data.length > 0 ? data[data.length - 1] : null;
  const previous = data.length > 1 ? data[data.length - 2] : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/reports" className="text-sm text-muted-foreground hover:underline">
          Reports
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-xl font-semibold">KPI Performance</h1>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label>Period</Label>
          <Select value={period} onValueChange={(v) => setPeriod(v ?? "6")}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 Months</SelectItem>
              <SelectItem value="6">6 Months</SelectItem>
              <SelectItem value="12">12 Months</SelectItem>
            </SelectContent>
          </Select>
        </div>
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

      {/* KPI Cards */}
      {current && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold text-green-600">{current.revenue.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}</p>
              {previous && <TrendArrow current={current.revenue} previous={previous.revenue} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">New Members</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold">{current.newMembers}</p>
              {previous && <TrendArrow current={current.newMembers} previous={previous.newMembers} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Renewals</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold">{current.renewals}</p>
              {previous && <TrendArrow current={current.renewals} previous={previous.renewals} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Avg Daily Attendance</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-bold">{current.avgDailyAttendance}</p>
              {previous && <TrendArrow current={current.avgDailyAttendance} previous={previous.avgDailyAttendance} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Churn Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-xl font-bold ${current.churnRate > 10 ? "text-red-500" : "text-green-600"}`}>{current.churnRate}%</p>
              {previous && (
                <span className={`text-xs ${current.churnRate < previous.churnRate ? "text-green-500" : current.churnRate > previous.churnRate ? "text-red-500" : "text-muted-foreground"}`}>
                  {previous.churnRate === 0 && current.churnRate === 0
                    ? "--"
                    : current.churnRate < previous.churnRate
                      ? `${Math.round(previous.churnRate - current.churnRate)}pp`
                      : current.churnRate > previous.churnRate
                        ? `+${Math.round(current.churnRate - previous.churnRate)}pp`
                        : "0pp"}
                </span>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Trend Chart */}
      {data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="#22c55e" name="Revenue" strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="newMembers" stroke="#3b82f6" name="New Members" strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="avgDailyAttendance" stroke="#f59e0b" name="Avg Attendance" strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="renewals" stroke="#8b5cf6" name="Renewals" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {data.length === 0 && !isPending && (
        <p className="text-center text-muted-foreground py-8">No data available. Click Load to fetch KPI data.</p>
      )}
    </div>
  );
}
