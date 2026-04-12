import { tool } from "@openai/agents";
import { z } from "zod";
import {
  addFollowup,
  getFollowupHistory,
  getOverdueEnquiryFollowups,
  getTodayFollowups,
} from "@/lib/actions/enquiry-followup";

export const enquiryFollowupTools = [
  tool({
    name: "add_enquiry_followup",
    description: "Log a followup action on an enquiry (call, visit, whatsapp, etc.) with outcome. If outcome is 'converted', enquiry is automatically marked as converted. Requires confirmation before executing.",
    parameters: z.object({
      enquiryId: z.number().describe("Enquiry ID"),
      action: z.enum(["call", "visit", "whatsapp", "email", "sms", "demo"]).describe("Followup action type"),
      outcome: z.enum(["interested", "not_interested", "no_answer", "callback", "visited", "converted"]).describe("Outcome of the followup"),
      notes: z.string().nullable().describe("Notes about the followup, null if none"),
      nextFollowupAt: z.string().nullable().describe("Next followup date/time (ISO string), null if none"),
    }),
    async execute(input) {
      const result = await addFollowup({ ...input, notes: input.notes ?? undefined, nextFollowupAt: input.nextFollowupAt ?? undefined });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_enquiry_followup_history",
    description: "Get the chronological followup timeline for a specific enquiry",
    parameters: z.object({
      enquiryId: z.number().describe("Enquiry ID"),
    }),
    async execute(input) {
      const result = await getFollowupHistory(input.enquiryId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_overdue_enquiry_followups",
    description: "Get enquiries where the scheduled followup date has passed without a newer followup",
    parameters: z.object({
      workerId: z.number().nullable().describe("Filter by worker ID (null for all workers)"),
    }),
    async execute(input) {
      const result = await getOverdueEnquiryFollowups(input.workerId ?? undefined);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_today_followups",
    description: "Get enquiry followups scheduled for today",
    parameters: z.object({
      workerId: z.number().nullable().describe("Filter by worker ID (null for all workers)"),
    }),
    async execute(input) {
      const result = await getTodayFollowups(input.workerId ?? undefined);
      return JSON.stringify(result);
    },
  }),
];
