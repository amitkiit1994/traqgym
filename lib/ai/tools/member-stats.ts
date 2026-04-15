import { tool } from "@openai/agents";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { computeSatisfactionScore } from "@/lib/services/satisfaction-score";

export const memberStatsTools = [
  tool({
    name: "get_member_satisfaction_score",
    description:
      "Get a member's satisfaction score (0-100) with breakdown by attendance, payment timeliness, feedback, tenure, and engagement",
    parameters: z.object({
      userId: z.number().describe("Member user ID"),
    }),
    async execute(input) {
      const result = await computeSatisfactionScore(input.userId);
      return JSON.stringify(result);
    },
  }),
  tool({
    name: "get_attendance_heatmap",
    description:
      "Get a member's attendance data for the last N days, showing which days they checked in and duration",
    parameters: z.object({
      userId: z.number().describe("Member user ID"),
      days: z
        .number()
        .nullable()
        .describe("Number of days to look back, default 30"),
    }),
    async execute(input) {
      const lookback = input.days ?? 30;
      const since = new Date();
      since.setDate(since.getDate() - lookback);
      since.setHours(0, 0, 0, 0);

      const logs = await prisma.attendanceLog.findMany({
        where: {
          userId: input.userId,
          checkIn: { gte: since },
        },
        select: { checkIn: true, checkOut: true, attendanceDate: true },
        orderBy: { checkIn: "asc" },
      });

      const dayMap: Record<
        string,
        { date: string; visits: number; totalMinutes: number }
      > = {};

      for (const log of logs) {
        const dateKey = log.attendanceDate.toISOString().split("T")[0];
        if (!dayMap[dateKey]) {
          dayMap[dateKey] = { date: dateKey, visits: 0, totalMinutes: 0 };
        }
        dayMap[dateKey].visits++;
        if (log.checkOut) {
          dayMap[dateKey].totalMinutes += Math.round(
            (log.checkOut.getTime() - log.checkIn.getTime()) / 60000
          );
        }
      }

      return JSON.stringify({
        userId: input.userId,
        period: `Last ${lookback} days`,
        totalDaysPresent: Object.keys(dayMap).length,
        totalVisits: logs.length,
        days: Object.values(dayMap),
      });
    },
  }),
];
