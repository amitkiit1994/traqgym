import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import { getTodaysBirthdays, getUpcomingBirthdays } from "@/lib/actions/birthdays";
import { getReferralsByUser, createReferral } from "@/lib/actions/referrals";
import { getMeasurements, addMeasurement } from "@/lib/actions/measurements";
import { getAuditLogs } from "@/lib/actions/audit";
import { prisma } from "@/lib/prisma";

export const miscTools = [
  tool({
    name: "get_todays_birthdays",
    description: "Get members with birthdays today",
    parameters: z.object({}),
    async execute() {
      const birthdays = await getTodaysBirthdays();
      return JSON.stringify(birthdays);
    },
  }),

  tool({
    name: "get_upcoming_birthdays",
    description: "Get upcoming member birthdays within N days",
    parameters: z.object({
      days: z.number().describe("Number of days to look ahead"),
    }),
    async execute(input) {
      const birthdays = await getUpcomingBirthdays(input.days);
      return JSON.stringify(birthdays);
    },
  }),

  tool({
    name: "get_referrals",
    description: "Get referrals made by a specific member",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
    }),
    async execute(input) {
      const referrals = await getReferralsByUser(input.userId);
      return JSON.stringify(referrals);
    },
  }),

  tool({
    name: "create_referral",
    description: "Log a referral from a member. Requires confirmation.",
    parameters: z.object({
      referrerId: z.number().describe("Referring member ID"),
      referredName: z.string().describe("Referred person's name"),
      referredPhone: z.string().describe("Referred person's phone"),
    }),
    async execute(input) {
      const result = await createReferral(input);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_measurements",
    description: "Get body measurements for a member",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
    }),
    async execute(input) {
      const measurements = await getMeasurements(input.userId);
      return JSON.stringify(measurements);
    },
  }),

  tool({
    name: "add_measurement",
    description: "Record body measurements for a member. Requires confirmation.",
    parameters: z.object({
      userId: z.number().describe("Member ID"),
      date: z.string().describe("Measurement date YYYY-MM-DD"),
      weight: z.number().nullable().describe("Weight in kg"),
      height: z.number().nullable().describe("Height in cm"),
      chest: z.number().nullable().describe("Chest in cm"),
      waist: z.number().nullable().describe("Waist in cm"),
      hips: z.number().nullable().describe("Hips in cm"),
      biceps: z.number().nullable().describe("Biceps in cm"),
      notes: z.string().nullable().describe("Notes"),
      recordedBy: z.number().nullable().describe("Worker ID who recorded"),
    }),
    async execute(input) {
      const { userId, ...data } = input;
      const result = await addMeasurement(userId, n(data));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_audit_logs",
    description: "Get audit trail of all actions. Admin only.",
    parameters: z.object({
      fromDate: z.string().nullable().describe("From date YYYY-MM-DD"),
      toDate: z.string().nullable().describe("To date YYYY-MM-DD"),
      action: z.string().nullable().describe("Filter by action type"),
      page: z.number().nullable().describe("Page number"),
      pageSize: z.number().nullable().describe("Results per page"),
    }),
    async execute(input) {
      const logs = await getAuditLogs(input.fromDate ?? undefined, input.toDate ?? undefined, input.action ?? undefined, input.page ?? undefined, input.pageSize ?? undefined);
      return JSON.stringify(logs);
    },
  }),

  tool({
    name: "get_settings",
    description: "Get all gym settings. Admin only.",
    parameters: z.object({}),
    async execute() {
      const settings = await prisma.gymSettings.findMany();
      const map: Record<string, string> = {};
      for (const s of settings) map[s.key] = s.value;
      return JSON.stringify(map);
    },
  }),
];
