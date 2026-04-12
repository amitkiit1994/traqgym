import { tool } from "@openai/agents";
import { z } from "zod";
import { notifyUser, notifyWorker } from "@/lib/services/in-app-notification";

export const inAppWriteTools = [
  tool({
    name: "notify_user",
    description:
      "Send an in-app notification to a member. Admin only. Requires confirmation.",
    parameters: z.object({
      userId: z.number().describe("Member user ID"),
      type: z
        .string()
        .describe("Notification type, e.g. 'reminder', 'alert', 'info'"),
      title: z.string().describe("Notification title"),
      message: z
        .string()
        .nullable()
        .describe("Notification body message"),
      link: z
        .string()
        .nullable()
        .describe("Optional link/route to navigate on click"),
    }),
    async execute(input) {
      const result = await notifyUser({
        userId: input.userId,
        type: input.type,
        title: input.title,
        message: input.message ?? undefined,
        link: input.link ?? undefined,
      });
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "notify_worker",
    description:
      "Send an in-app notification to a staff member. Admin only. Requires confirmation.",
    parameters: z.object({
      workerId: z.number().describe("Worker ID"),
      type: z
        .string()
        .describe("Notification type, e.g. 'task', 'alert', 'info'"),
      title: z.string().describe("Notification title"),
      message: z
        .string()
        .nullable()
        .describe("Notification body message"),
      link: z
        .string()
        .nullable()
        .describe("Optional link/route to navigate on click"),
    }),
    async execute(input) {
      const result = await notifyWorker({
        workerId: input.workerId,
        type: input.type,
        title: input.title,
        message: input.message ?? undefined,
        link: input.link ?? undefined,
      });
      return JSON.stringify(result);
    },
  }),
];
