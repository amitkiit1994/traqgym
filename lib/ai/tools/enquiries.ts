import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import {
  getEnquiries,
  createEnquiry,
  updateEnquiry,
  convertEnquiry,
} from "@/lib/actions/enquiries";

export const enquiryTools = [
  tool({
    name: "get_enquiries",
    description: "List enquiries/leads with optional filters",
    parameters: z.object({
      status: z.string().nullable().describe("Filter: new, contacted, visited, converted, lost"),
      locationId: z.number().nullable().describe("Filter by location"),
    }),
    async execute(input) {
      const { data } = await getEnquiries({ status: input.status ?? undefined, locationId: input.locationId ?? undefined });
      return JSON.stringify(data);
    },
  }),

  tool({
    name: "create_enquiry",
    description: "Log a new enquiry/lead. Requires confirmation.",
    parameters: z.object({
      name: z.string().describe("Prospect name"),
      phone: z.string().describe("Phone number"),
      email: z.string().nullable().describe("Email"),
      source: z.string().nullable().describe("Source: walk_in, call, referral, social_media, website"),
      interest: z.string().nullable().describe("Interest area"),
      locationId: z.number().nullable().describe("Location ID"),
      notes: z.string().nullable().describe("Notes"),
      followUpDate: z.string().nullable().describe("Follow-up date YYYY-MM-DD"),
    }),
    async execute(input) {
      const result = await createEnquiry(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "update_enquiry",
    description: "Update an enquiry's status or details. Requires confirmation.",
    parameters: z.object({
      enquiryId: z.number().describe("Enquiry ID"),
      status: z.string().nullable().describe("New status"),
      notes: z.string().nullable().describe("Updated notes"),
      followUpDate: z.string().nullable().describe("New follow-up date or null to clear"),
      interest: z.string().nullable().describe("Interest area"),
      source: z.string().nullable().describe("Source"),
    }),
    async execute(input) {
      const { enquiryId, ...data } = input;
      const result = await updateEnquiry(enquiryId, n(data));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "convert_enquiry",
    description: "Convert an enquiry to a member. Creates a new member account. Requires confirmation.",
    parameters: z.object({
      enquiryId: z.number().describe("Enquiry ID to convert"),
    }),
    async execute(input) {
      const result = await convertEnquiry(input.enquiryId);
      return JSON.stringify(result);
    },
  }),
];
