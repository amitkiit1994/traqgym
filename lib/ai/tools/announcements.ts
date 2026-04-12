import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import {
  getAllAnnouncements,
  createAnnouncement,
  toggleAnnouncement,
} from "@/lib/actions/announcements";

export const announcementTools = [
  tool({
    name: "get_announcements",
    description: "List all announcements",
    parameters: z.object({}),
    async execute() {
      const announcements = await getAllAnnouncements();
      return JSON.stringify(announcements);
    },
  }),

  tool({
    name: "create_announcement",
    description: "Create a new announcement. Requires confirmation.",
    parameters: z.object({
      title: z.string().describe("Announcement title"),
      content: z.string().describe("Announcement content"),
      priority: z.string().nullable().describe("Priority: low, normal, high, urgent"),
      targetGroup: z.string().nullable().describe("Target: all, members, staff"),
      locationId: z.number().nullable().describe("Location ID (null for all)"),
      expiresAt: z.string().nullable().describe("Expiry date ISO string"),
    }),
    async execute(input) {
      const result = await createAnnouncement(n(input));
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "toggle_announcement",
    description: "Activate or deactivate an announcement. Requires confirmation.",
    parameters: z.object({
      announcementId: z.number().describe("Announcement ID"),
    }),
    async execute(input) {
      const result = await toggleAnnouncement(input.announcementId);
      return JSON.stringify(result);
    },
  }),
];
