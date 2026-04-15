"use client";

import { useEffect, useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Worker = { id: number; name: string };
type DayEntry = { date: string; workerId: number; status: "present" | "leave" | "absent" };

async function fetchSchedule(month: number, year: number, locationId?: number) {
  const { getStaffScheduleAction } = await import("@/lib/actions/staff-calendar");
  return getStaffScheduleAction(month, year, locationId);
}

async function fetchLocations() {
  const { getLocations } = await import("@/lib/actions/locations");
  return getLocations();
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function isSunday(dateStr: string) {
  return new Date(dateStr).getDay() === 0;
}

function isFuture(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr) > today;
}

export default function StaffCalendarPage() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [locationId, setLocationId] = useState<number | undefined>(undefined);
  const [locations, setLocations] = useState<{ id: number; name: string }[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [days, setDays] = useState<DayEntry[]>([]);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const locs = await fetchLocations();
      setLocations(locs.map((l: { id: number; name: string }) => ({ id: l.id, name: l.name })));
    });
  }, []);

  useEffect(() => {
    startTransition(async () => {
      const data = await fetchSchedule(month, year, locationId);
      setWorkers(data.workers);
      setDays(data.days);
    });
  }, [month, year, locationId]);

  const prevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  };

  const nextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  };

  // Build lookup: "workerId:date" -> status
  const statusMap = new Map<string, DayEntry["status"]>();
  for (const d of days) {
    statusMap.set(`${d.workerId}:${d.date}`, d.status);
  }

  // Get unique dates in order
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates: string[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month - 1, d);
    dates.push(dateObj.toISOString().split("T")[0]);
  }

  function cellColor(dateStr: string, status: DayEntry["status"]) {
    if (isFuture(dateStr)) return "bg-background";
    if (isSunday(dateStr)) return "bg-background";
    switch (status) {
      case "present":
        return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400";
      case "leave":
        return "bg-red-500/20 text-red-700 dark:text-red-400";
      case "absent":
        return "bg-muted text-muted-foreground";
      default:
        return "";
    }
  }

  function cellLabel(dateStr: string, status: DayEntry["status"]) {
    if (isFuture(dateStr)) return "";
    if (isSunday(dateStr)) return "";
    switch (status) {
      case "present":
        return "P";
      case "leave":
        return "L";
      case "absent":
        return "A";
      default:
        return "";
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold">Staff Calendar</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Label className="text-sm">Location:</Label>
            <select
              value={locationId ?? ""}
              onChange={(e) =>
                setLocationId(e.target.value ? Number(e.target.value) : undefined)
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-sm font-medium min-w-[140px] text-center">
              {MONTH_NAMES[month - 1]} {year}
            </span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isPending ? (
            <div className="p-8 text-center text-muted-foreground">Loading...</div>
          ) : workers.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No workers found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-2 py-2 text-left font-medium sticky left-0 bg-muted/50 z-10 min-w-[120px]">
                      Staff
                    </th>
                    {dates.map((d) => {
                      const dayNum = new Date(d).getDate();
                      const sun = isSunday(d);
                      return (
                        <th
                          key={d}
                          className={`px-1 py-2 text-center font-medium min-w-[28px] ${sun ? "text-muted-foreground/50" : ""}`}
                        >
                          {dayNum}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {workers.map((w) => (
                    <tr key={w.id} className="border-b">
                      <td className="px-2 py-1.5 font-medium sticky left-0 bg-background z-10 whitespace-nowrap">
                        {w.name}
                      </td>
                      {dates.map((d) => {
                        const status = statusMap.get(`${w.id}:${d}`) ?? "absent";
                        return (
                          <td
                            key={d}
                            className={`px-1 py-1.5 text-center font-semibold ${cellColor(d, status)}`}
                            title={`${w.name} - ${d}: ${isSunday(d) ? "Sunday" : isFuture(d) ? "Future" : status}`}
                          >
                            {cellLabel(d, status)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <span className="inline-block size-3 rounded bg-emerald-500/20 border border-emerald-500/30" />
          <span>P = Present</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block size-3 rounded bg-red-500/20 border border-red-500/30" />
          <span>L = Leave</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block size-3 rounded bg-muted border border-border" />
          <span>A = Absent</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block size-3 rounded bg-background border border-border" />
          <span>Sunday / Future</span>
        </div>
      </div>
    </div>
  );
}
