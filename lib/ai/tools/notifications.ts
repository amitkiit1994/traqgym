import { tool } from "@openai/agents";
import { z } from "zod";
import { n } from "./utils";
import {
  sendBulkNotification,
  sendTargetedNotification,
  getSegmentMembers,
} from "@/lib/actions/bulk-notify";
import {
  getNotificationLogs,
  resendFailedNotification,
  getNotificationAnalytics,
} from "@/lib/actions/notifications";

export const notificationTools = [
  tool({
    name: "send_bulk_notification",
    description: "Send bulk WhatsApp/SMS notification to a segment of members (e.g. expiring, overdue, active). Requires confirmation.",
    parameters: z.object({
      segment: z.string().describe("Member segment: expiring_7d, overdue, active, all"),
      templateName: z.string().describe("Notification template name"),
      customMessage: z.string().nullable().describe("Custom message to send"),
    }),
    async execute(input) {
      const result = await sendBulkNotification(input.segment, input.templateName, input.customMessage ?? undefined);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "send_targeted_notification",
    description: "Send notification to specific members by IDs. Requires confirmation.",
    parameters: z.object({
      userIds: z.array(z.number()).describe("Array of member IDs"),
      templateName: z.string().describe("Template name"),
      customMessage: z.string().nullable().describe("Custom message"),
    }),
    async execute(input) {
      const result = await sendTargetedNotification(input.userIds, input.templateName, input.customMessage ?? undefined);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_segment_members",
    description: "Preview which members belong to a notification segment before sending",
    parameters: z.object({
      segment: z.string().describe("Segment: expiring_7d, overdue, active, all"),
    }),
    async execute(input) {
      const members = await getSegmentMembers(input.segment);
      return JSON.stringify(members);
    },
  }),

  tool({
    name: "get_notification_logs",
    description: "Get notification history/logs",
    parameters: z.object({
      status: z.string().nullable().describe("Filter by status: sent, failed, pending"),
      channel: z.string().nullable().describe("Filter by channel: whatsapp, sms, email"),
      limit: z.number().nullable().describe("Max results"),
    }),
    async execute(input) {
      const logs = await getNotificationLogs(n(input));
      return JSON.stringify(logs);
    },
  }),

  tool({
    name: "resend_failed_notification",
    description: "Resend a failed notification by its ID. Requires confirmation.",
    parameters: z.object({
      notificationId: z.number().describe("The notification log ID to resend"),
    }),
    async execute(input) {
      const result = await resendFailedNotification(input.notificationId);
      return JSON.stringify(result);
    },
  }),

  tool({
    name: "get_notification_analytics",
    description: "Get notification delivery analytics: total, sent, failed, pending counts, success rate %, and channel breakdown",
    parameters: z.object({
      dateFrom: z.string().nullable().describe("Start date (YYYY-MM-DD)"),
      dateTo: z.string().nullable().describe("End date (YYYY-MM-DD)"),
    }),
    async execute(input) {
      const stats = await getNotificationAnalytics(n(input));
      return JSON.stringify(stats);
    },
  }),
];
