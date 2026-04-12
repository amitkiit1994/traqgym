import { tool } from "@openai/agents";
import { z } from "zod";
import { getDailyAttendance, manualCheckIn } from "@/lib/actions/attendance";
import { getAttendanceReport } from "@/lib/actions/reports";
import {
  getWorkerDailyAttendance,
  workerCheckIn,
  workerCheckOut,
} from "@/lib/actions/worker-attendance";

export const attendanceTools = [
  tool({
    name: "get_daily_attendance",
    description: "Get today's member check-in/check-out list",
    parameters: z.object({
      date: z.string().describe("Date in YYYY-MM-DD format"),
      locationId: z.number().nullable().describe("Filter by location"),
    }),
    async execute(input) {
      const attendance = await getDailyAttendance(input.date, input.locationId ?? undefined);
      return JSON.stringify(attendance);
    },
  }),

  tool({
    name: "get_attendance_report",
    description: "Get attendance report for a date range",
    parameters: z.object({
      fromDate: z.string().describe("Start date YYYY-MM-DD"),
      toDate: z.string().describe("End date YYYY-MM-DD"),
      locationId: z.number().nullable().describe("Filter by location"),
    }),
    async execute(input) {
      const report = await getAttendanceReport(input.fromDate, input.toDate, input.locationId ?? undefined);
      return JSON.stringify(report);
    },
  }),

  tool({
    name: "manual_check_in",
    description: "Manually check in a member. Requires confirmation.",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
      locationId: z.number().describe("Location ID"),
    }),
    async execute(input) {
      const result = await manualCheckIn(input.userId, input.locationId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_worker_attendance",
    description: "Get staff/worker attendance for a specific date",
    parameters: z.object({
      date: z.string().describe("Date in YYYY-MM-DD format"),
      locationId: z.number().nullable().describe("Filter by location"),
    }),
    async execute(input) {
      const attendance = await getWorkerDailyAttendance(input.date, input.locationId ?? undefined);
      return JSON.stringify(attendance);
    },
  }),

  tool({
    name: "worker_check_in",
    description: "Check in a staff member. Requires confirmation.",
    parameters: z.object({
      workerId: z.number().describe("Worker ID"),
      locationId: z.number().describe("Location ID"),
    }),
    async execute(input) {
      const result = await workerCheckIn(input.workerId, input.locationId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "worker_check_out",
    description: "Check out a staff member. Requires confirmation.",
    parameters: z.object({
      attendanceId: z.number().describe("Attendance log ID"),
    }),
    async execute(input) {
      const result = await workerCheckOut(input.attendanceId);
      return JSON.stringify(result);
    },
  }),
];
