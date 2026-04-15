import { prisma } from "@/lib/prisma";

type DayStatus = "present" | "leave" | "absent";

type StaffScheduleResult = {
  workers: { id: number; name: string }[];
  days: { date: string; workerId: number; status: DayStatus }[];
};

export async function getStaffSchedule(params: {
  month: number; // 1-indexed
  year: number;
  locationId?: number;
}): Promise<StaffScheduleResult> {
  const { month, year, locationId } = params;

  // Get active workers at this location
  const workers = await prisma.worker.findMany({
    where: {
      isActive: true,
      ...(locationId ? { locationId } : {}),
    },
    select: { id: true, firstname: true, lastname: true },
    orderBy: { firstname: "asc" },
  });

  if (workers.length === 0) {
    return { workers: [], days: [] };
  }

  const workerIds = workers.map((w) => w.id);

  // Date range for the month
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0); // last day of month
  const daysInMonth = monthEnd.getDate();

  // Fetch attendance logs for workers in this month
  const attendanceLogs = await prisma.attendanceLog.findMany({
    where: {
      workerId: { in: workerIds },
      attendanceDate: { gte: monthStart, lte: monthEnd },
      ...(locationId ? { locationId } : {}),
    },
    select: { workerId: true, attendanceDate: true },
  });

  // Build a set of "workerId:YYYY-MM-DD" for quick lookup
  const attendanceSet = new Set<string>();
  for (const log of attendanceLogs) {
    if (log.workerId) {
      const d = log.attendanceDate.toISOString().split("T")[0];
      attendanceSet.add(`${log.workerId}:${d}`);
    }
  }

  // Fetch approved leave requests covering this month
  const leaveRequests = await prisma.leaveRequest.findMany({
    where: {
      workerId: { in: workerIds },
      status: "approved",
      startDate: { lte: monthEnd },
      endDate: { gte: monthStart },
    },
    select: { workerId: true, startDate: true, endDate: true },
  });

  // Build a set of "workerId:YYYY-MM-DD" for leave days
  const leaveSet = new Set<string>();
  for (const lr of leaveRequests) {
    const start = lr.startDate < monthStart ? monthStart : lr.startDate;
    const end = lr.endDate > monthEnd ? monthEnd : lr.endDate;
    const cur = new Date(start);
    while (cur <= end) {
      const d = cur.toISOString().split("T")[0];
      leaveSet.add(`${lr.workerId}:${d}`);
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Build the days array
  const days: StaffScheduleResult["days"] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateObj = new Date(year, month - 1, day);
    const dateStr = dateObj.toISOString().split("T")[0];

    for (const wId of workerIds) {
      const key = `${wId}:${dateStr}`;
      let status: DayStatus;
      if (attendanceSet.has(key)) {
        status = "present";
      } else if (leaveSet.has(key)) {
        status = "leave";
      } else {
        status = "absent";
      }
      days.push({ date: dateStr, workerId: wId, status });
    }
  }

  return {
    workers: workers.map((w) => ({
      id: w.id,
      name: `${w.firstname} ${w.lastname}`,
    })),
    days,
  };
}
