"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { TrendingUp, Trophy } from "lucide-react";

const formatINR = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);

type Props = {
  attendanceChartData: { date: string; count: number }[];
  staffPerformance: { name: string; total: number; renewals: number }[];
};

export function AttendanceAndStaffSection({ attendanceChartData, staffPerformance }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
      {/* Attendance Trend */}
      <Card className="gradient-border-card bg-card/70 dark:bg-card/80 backdrop-blur-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="size-4" />
            Attendance Trend (30 Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={attendanceChartData}>
                <defs>
                  <linearGradient id="attendanceGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" strokeOpacity={0.5} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => {
                    const d = new Date(v);
                    return `${d.getDate()}/${d.getMonth() + 1}`;
                  }}
                  stroke="var(--color-muted-foreground)"
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tickLine={false}
                />
                <YAxis
                  stroke="var(--color-muted-foreground)"
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip
                  labelFormatter={(v) => new Date(v).toLocaleDateString("en-IN")}
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
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fill="url(#attendanceGrad)"
                  name="Check-ins"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Staff Leaderboard */}
      {staffPerformance.length > 0 && (
        <Card className="gradient-border-card bg-card/70 dark:bg-card/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="size-4" />
              Staff Collections (This Month)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {staffPerformance.map((s, idx) => {
                const maxTotal = staffPerformance[0]?.total || 1;
                const pct = Math.round((s.total / maxTotal) * 100);
                return (
                  <div key={s.name} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground font-mono text-xs w-4">
                          #{idx + 1}
                        </span>
                        <span className="font-medium">{s.name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span className="text-xs">{s.renewals} renewals</span>
                        <span className="font-medium text-foreground">
                          {formatINR(s.total)}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <Link href="/admin/staff-performance">
              <Button variant="link" size="sm" className="mt-3 px-0 h-auto text-xs">
                View full report
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
