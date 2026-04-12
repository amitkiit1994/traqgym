"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type StaffRow = {
  id: number;
  name: string;
  role: string;
  renewalCount: number;
  cashCollected: number;
  upiCollected: number;
  totalCollected: number;
};

async function fetchPerformance(month: string) {
  const [year, m] = month.split("-").map(Number);
  const monthStart = new Date(year, m - 1, 1);
  const monthEnd = new Date(year, m, 1);

  // Import here since this is a client component calling a server action
  const { getStaffPerformanceAction } = await import("@/lib/actions/staff-performance");
  return getStaffPerformanceAction(monthStart.toISOString(), monthEnd.toISOString());
}

export default function StaffPerformancePage() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [month, setMonth] = useState(defaultMonth);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [totalCheckIns, setTotalCheckIns] = useState(0);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const data = await fetchPerformance(month);
      setStaff(data.staff);
      setTotalCheckIns(data.totalCheckIns);
    });
  }, [month]);

  const totals = staff.reduce(
    (acc, s) => ({
      renewals: acc.renewals + s.renewalCount,
      cash: acc.cash + s.cashCollected,
      upi: acc.upi + s.upiCollected,
      total: acc.total + s.totalCollected,
    }),
    { renewals: 0, cash: 0, upi: 0, total: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Staff Performance</h1>
        <div className="flex items-center gap-2">
          <Label>Month:</Label>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-full sm:w-40"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">Staff Name</th>
                  <th className="px-4 py-2 text-right font-medium">Renewals</th>
                  <th className="px-4 py-2 text-right font-medium hidden md:table-cell">Cash Collected</th>
                  <th className="px-4 py-2 text-right font-medium hidden md:table-cell">UPI Collected</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id} className="border-b">
                    <td className="px-4 py-2">
                      {s.name}
                      <span className="ml-1 text-xs text-muted-foreground capitalize">({s.role})</span>
                    </td>
                    <td className="px-4 py-2 text-right">{s.renewalCount}</td>
                    <td className="px-4 py-2 text-right hidden md:table-cell">Rs.{s.cashCollected.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2 text-right hidden md:table-cell">Rs.{s.upiCollected.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2 text-right font-medium">Rs.{s.totalCollected.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
                {staff.length > 0 && (
                  <tr className="border-t-2 font-semibold bg-muted/30">
                    <td className="px-4 py-2">Totals</td>
                    <td className="px-4 py-2 text-right">{totals.renewals}</td>
                    <td className="px-4 py-2 text-right hidden md:table-cell">Rs.{totals.cash.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2 text-right hidden md:table-cell">Rs.{totals.upi.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2 text-right">Rs.{totals.total.toLocaleString("en-IN")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Total Member Check-ins This Month</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xl md:text-2xl font-bold">{totalCheckIns}</p>
        </CardContent>
      </Card>
    </div>
  );
}
