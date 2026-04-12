"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Props = {
  data: { date: string; present: number }[];
};

export function StatsChart({ data }: Props) {
  const totalPresent = data.filter((d) => d.present === 1).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Last 30 Days — {totalPresent} day{totalPresent !== 1 ? "s" : ""}{" "}
          present
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-48 sm:h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => {
                  const d = new Date(v);
                  return `${d.getDate()}/${d.getMonth() + 1}`;
                }}
                interval={4}
              />
              <YAxis domain={[0, 1]} ticks={[0, 1]} />
              <Tooltip
                labelFormatter={(v) =>
                  new Date(v).toLocaleDateString("en-IN", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })
                }
                formatter={(value) =>
                  value === 1 ? "Present" : "Absent"
                }
              />
              <Bar dataKey="present" fill="#16a34a" name="Attendance" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
