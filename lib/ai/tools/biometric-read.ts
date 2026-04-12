import { tool } from "@openai/agents";
import { z } from "zod";
import { getUnmatched } from "@/lib/services/biometric";
import { prisma } from "@/lib/prisma";

export const biometricReadTools = [
  tool({
    name: "get_unmatched_biometric",
    description:
      "Get biometric attendance events that couldn't be matched to any member or worker. These need manual resolution.",
    parameters: z.object({}),
    async execute() {
      const events = await getUnmatched();
      return JSON.stringify(
        events.map((e) => ({
          id: e.id,
          deviceUserId: e.deviceUserId,
          eventTimestamp: e.eventTimestamp.toISOString(),
          eventType: e.eventType,
          deviceName: e.device.name,
        }))
      );
    },
  }),

  tool({
    name: "get_biometric_devices",
    description:
      "Get all configured biometric devices with their location and last sync time",
    parameters: z.object({}),
    async execute() {
      const devices = await prisma.biometricDevice.findMany({
        include: { location: { select: { name: true } } },
        orderBy: { id: "asc" },
      });
      return JSON.stringify(
        devices.map((d) => ({
          id: d.id,
          name: d.name,
          location: d.location.name,
          deviceType: d.deviceType,
          lastSyncAt: d.lastSyncAt?.toISOString() ?? null,
        }))
      );
    },
  }),

  tool({
    name: "get_sync_history",
    description:
      "Get recent biometric sync run history showing import results (matched, unmatched, duplicates)",
    parameters: z.object({
      limit: z
        .number()
        .nullable()
        .describe("Number of recent runs to return, default 20"),
    }),
    async execute(input) {
      const runs = await prisma.biometricSyncRun.findMany({
        include: { device: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: input.limit ?? 20,
      });
      return JSON.stringify(
        runs.map((r) => ({
          id: r.id,
          deviceName: r.device.name,
          runType: r.runType,
          status: r.status,
          totalRecords: r.totalRecords,
          matchedRecords: r.matchedRecords,
          unmatchedRecords: r.unmatchedRecords,
          duplicateRecords: r.duplicateRecords,
          startedAt: r.startedAt?.toISOString() ?? null,
          completedAt: r.completedAt?.toISOString() ?? null,
        }))
      );
    },
  }),
];
