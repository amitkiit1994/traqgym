import { tool } from "@openai/agents";
import { z } from "zod";
import { resolveMapping } from "@/lib/services/biometric";

export const biometricWriteTools = [
  tool({
    name: "resolve_biometric_mapping",
    description:
      "Map an unmatched biometric event to a member or worker. This also resolves all other unmatched events from the same device user. Admin only. Requires confirmation.",
    parameters: z.object({
      eventId: z.number().describe("Raw attendance event ID to resolve"),
      userId: z
        .number()
        .nullable()
        .describe("Member user ID to map to (provide this OR workerId)"),
      workerId: z
        .number()
        .nullable()
        .describe("Worker ID to map to (provide this OR userId)"),
    }),
    async execute(input) {
      try {
        const result = await resolveMapping(input.eventId, {
          userId: input.userId ?? undefined,
          workerId: input.workerId ?? undefined,
        });
        return JSON.stringify({ success: true, ...result });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return JSON.stringify({ success: false, error: message });
      }
    },
  }),
];
