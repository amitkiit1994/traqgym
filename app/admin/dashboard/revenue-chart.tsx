"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type RevenueChartItem = { date: string; cash: number; upi: number; other: number };

export function RevenueChart({
  data,
  title = "Revenue (Last 7 Days)",
  toolbar,
}: {
  data: RevenueChartItem[];
  title?: string;
  toolbar?: React.ReactNode;
}) {
  return (
    <Card className="gradient-border-card bg-card/70 dark:bg-card/80 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        {toolbar}
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
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
              <Legend
                wrapperStyle={{ color: "var(--color-muted-foreground)", fontSize: 12 }}
              />
              <Bar dataKey="cash" fill="#22c55e" name="Cash" radius={[4, 4, 0, 0]} />
              <Bar dataKey="upi" fill="#6366f1" name="UPI" radius={[4, 4, 0, 0]} />
              <Bar dataKey="other" fill="#a78bfa" name="Other" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
