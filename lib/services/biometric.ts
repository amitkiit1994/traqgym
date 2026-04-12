import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { getSetting } from "@/lib/services/settings";

// ─── Provider Adapter Interface ─────────────────────────────────────────────
// All biometric providers must normalize into:
//   BiometricSyncRun → RawAttendanceEvent → DeviceUserMapping → AttendanceLog

export interface BiometricEvent {
  deviceUserId: string;
  eventTimestamp: Date;
  eventType: string; // "check_in" | "check_out"
}

export interface ImportResult {
  total: number;
  matched: number;
  unmatched: number;
  duplicates: number;
  syncRunId: number;
  warning?: string;
}

// ─── Shared Pipeline ────────────────────────────────────────────────────────
// Both CSV and BioMax feed into this. Takes parsed events and produces
// BiometricSyncRun + RawAttendanceEvent + AttendanceLog rows.

async function ingestEvents(
  deviceId: number,
  events: BiometricEvent[],
  meta: { runType: string; fileName?: string; fileHash?: string }
): Promise<ImportResult> {
  const device = await prisma.biometricDevice.findUnique({
    where: { id: deviceId },
  });
  if (!device) throw new Error("Device not found");

  // Check for duplicate import (by file hash if available)
  let warning: string | undefined;
  if (meta.fileHash) {
    const existingRun = await prisma.biometricSyncRun.findFirst({
      where: { deviceId, fileHash: meta.fileHash },
    });
    if (existingRun) {
      warning = "This file has been imported before. Duplicates will be skipped.";
    }
  }

  // Create sync run
  const syncRun = await prisma.biometricSyncRun.create({
    data: {
      deviceId,
      fileName: meta.fileName,
      fileHash: meta.fileHash,
      runType: meta.runType,
      status: "running",
      startedAt: new Date(),
    },
  });

  let total = 0;
  let matched = 0;
  let unmatched = 0;
  let duplicates = 0;

  for (const evt of events) {
    total++;

    // Upsert RawAttendanceEvent (skip on duplicate)
    let event;
    try {
      event = await prisma.rawAttendanceEvent.create({
        data: {
          syncRunId: syncRun.id,
          deviceId,
          deviceUserId: evt.deviceUserId,
          eventTimestamp: evt.eventTimestamp,
          eventType: evt.eventType,
          matchStatus: "unmatched",
        },
      });
    } catch (err: any) {
      if (err.code === "P2002") {
        duplicates++;
        continue;
      }
      throw err;
    }

    // Lookup mapping
    const mapping = await prisma.deviceUserMapping.findUnique({
      where: {
        deviceId_deviceUserId: { deviceId, deviceUserId: evt.deviceUserId },
      },
    });

    if (mapping) {
      await prisma.rawAttendanceEvent.update({
        where: { id: event.id },
        data: {
          matchStatus: "matched",
          matchedUserId: mapping.userId,
          matchedWorkerId: mapping.workerId,
        },
      });

      // Create AttendanceLog
      const attendanceDate = new Date(
        evt.eventTimestamp.toISOString().split("T")[0]
      );

      try {
        if (mapping.userId) {
          await prisma.attendanceLog.create({
            data: {
              userId: mapping.userId,
              locationId: device.locationId,
              attendanceDate,
              checkIn: evt.eventTimestamp,
              source: "biometric",
              sourceEventId: event.id,
              deviceId,
            },
          });
        } else if (mapping.workerId) {
          await prisma.attendanceLog.create({
            data: {
              workerId: mapping.workerId,
              locationId: device.locationId,
              attendanceDate,
              checkIn: evt.eventTimestamp,
              source: "biometric",
              sourceEventId: event.id,
              deviceId,
            },
          });
        }
      } catch (err: any) {
        if (err.code !== "P2002") throw err;
      }

      matched++;
    } else {
      unmatched++;
    }
  }

  // Finalize sync run
  await prisma.biometricSyncRun.update({
    where: { id: syncRun.id },
    data: {
      status: "completed",
      totalRecords: total,
      matchedRecords: matched,
      unmatchedRecords: unmatched,
      duplicateRecords: duplicates,
      completedAt: new Date(),
    },
  });

  return { total, matched, unmatched, duplicates, syncRunId: syncRun.id, warning };
}

// ─── Provider: CSV Import (default MVP workflow) ────────────────────────────
// Format: deviceUserId,eventTimestamp,eventType
// e.g.   U001,2026-04-09T08:15:00+05:30,check_in

export async function importCSV(
  deviceId: number,
  csvContent: string
): Promise<ImportResult> {
  const device = await prisma.biometricDevice.findUnique({
    where: { id: deviceId },
  });
  if (!device) throw new Error("Device not found");

  const fileHash = crypto
    .createHash("sha256")
    .update(csvContent)
    .digest("hex");

  // Parse CSV into BiometricEvent[]
  const lines = csvContent.trim().split("\n");
  const dataLines = lines.slice(1).filter((l) => l.trim());
  const events: BiometricEvent[] = [];

  for (const line of dataLines) {
    const parts = line.split(device.csvDelimiter);
    if (parts.length < 3) continue;
    events.push({
      deviceUserId: parts[0].trim(),
      eventTimestamp: new Date(parts[1].trim()),
      eventType: parts[2].trim() || "check_in",
    });
  }

  return ingestEvents(deviceId, events, {
    runType: "csv",
    fileName: `csv-upload-${Date.now()}`,
    fileHash,
  });
}

// ─── Provider: BioMax SDK ───────────────────────────────────────────────────
// Fetches attendance records from a BioMax device via its HTTP SDK.
// Env config:
//   BIOMAX_SDK_BASE_URL  — e.g. http://192.168.1.100:8090
//   BIOMAX_SDK_API_KEY   — device API key (if required)
//
// When the SDK is unreachable or unconfigured, this function will throw
// a clear error so the caller can fall back to CSV import.

export interface BioMaxConfig {
  baseUrl: string;
  apiKey?: string;
}

async function getBioMaxConfig(): Promise<BioMaxConfig | null> {
  const baseUrl = (await getSetting("biomax_sdk_base_url", "")) || process.env.BIOMAX_SDK_BASE_URL;
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: (await getSetting("biomax_sdk_api_key", "")) || process.env.BIOMAX_SDK_API_KEY,
  };
}

/**
 * Sync attendance records from a BioMax device via SDK.
 *
 * Expected BioMax API response format:
 * {
 *   "records": [
 *     { "userId": "U001", "timestamp": "2026-04-09T08:15:00+05:30", "type": "check_in" },
 *     ...
 *   ]
 * }
 *
 * All records are normalized into the same pipeline as CSV imports:
 * BiometricSyncRun → RawAttendanceEvent → (match) → AttendanceLog
 */
export async function syncFromBiomax(
  deviceId: number
): Promise<ImportResult> {
  const config = await getBioMaxConfig();
  if (!config) {
    throw new Error(
      "BioMax SDK not configured. Set BIOMAX_SDK_BASE_URL in .env. Falling back to CSV import."
    );
  }

  const device = await prisma.biometricDevice.findUnique({
    where: { id: deviceId },
  });
  if (!device) throw new Error("Device not found");

  // Determine sync window: from last sync or last 24 hours
  const since = device.lastSyncAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Fetch from BioMax SDK
  const url = `${config.baseUrl}/api/attendance?since=${since.toISOString()}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) {
    headers["X-API-Key"] = config.apiKey;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(
      `BioMax SDK returned ${response.status}: ${await response.text()}`
    );
  }

  const data = await response.json();
  const records: Array<{
    userId: string;
    timestamp: string;
    type?: string;
  }> = data.records ?? [];

  // Normalize into BiometricEvent[]
  const events: BiometricEvent[] = records.map((r) => ({
    deviceUserId: r.userId,
    eventTimestamp: new Date(r.timestamp),
    eventType: r.type || "check_in",
  }));

  const result = await ingestEvents(deviceId, events, {
    runType: "biomax_sdk",
  });

  // Update device lastSyncAt
  await prisma.biometricDevice.update({
    where: { id: deviceId },
    data: { lastSyncAt: new Date() },
  });

  return result;
}

// ─── Shared Queries ─────────────────────────────────────────────────────────

export async function getUnmatched() {
  return prisma.rawAttendanceEvent.findMany({
    where: { matchStatus: "unmatched" },
    include: {
      device: { select: { name: true, locationId: true } },
    },
    orderBy: { eventTimestamp: "desc" },
  });
}

export async function resolveMapping(
  eventId: number,
  target: { userId?: number; workerId?: number }
) {
  if (!target.userId && !target.workerId) {
    throw new Error("Must provide userId or workerId");
  }
  if (target.userId && target.workerId) {
    throw new Error("Provide only one of userId or workerId");
  }

  const event = await prisma.rawAttendanceEvent.findUnique({
    where: { id: eventId },
    include: { device: true },
  });
  if (!event) throw new Error("Event not found");

  // Create or update DeviceUserMapping
  await prisma.deviceUserMapping.upsert({
    where: {
      deviceId_deviceUserId: {
        deviceId: event.deviceId,
        deviceUserId: event.deviceUserId,
      },
    },
    create: {
      deviceId: event.deviceId,
      deviceUserId: event.deviceUserId,
      userId: target.userId ?? null,
      workerId: target.workerId ?? null,
    },
    update: {
      userId: target.userId ?? null,
      workerId: target.workerId ?? null,
    },
  });

  // Update all unmatched events with same device+deviceUserId
  await prisma.rawAttendanceEvent.updateMany({
    where: {
      deviceId: event.deviceId,
      deviceUserId: event.deviceUserId,
      matchStatus: "unmatched",
    },
    data: {
      matchStatus: "matched",
      matchedUserId: target.userId ?? null,
      matchedWorkerId: target.workerId ?? null,
    },
  });

  // Create AttendanceLog entries for all newly matched events
  const matchedEvents = await prisma.rawAttendanceEvent.findMany({
    where: {
      deviceId: event.deviceId,
      deviceUserId: event.deviceUserId,
    },
    include: { device: true },
  });

  for (const evt of matchedEvents) {
    const attendanceDate = new Date(
      evt.eventTimestamp.toISOString().split("T")[0]
    );
    try {
      if (target.userId) {
        await prisma.attendanceLog.create({
          data: {
            userId: target.userId,
            locationId: evt.device.locationId,
            attendanceDate,
            checkIn: evt.eventTimestamp,
            source: "biometric",
            sourceEventId: evt.id,
            deviceId: evt.deviceId,
          },
        });
      } else if (target.workerId) {
        await prisma.attendanceLog.create({
          data: {
            workerId: target.workerId,
            locationId: evt.device.locationId,
            attendanceDate,
            checkIn: evt.eventTimestamp,
            source: "biometric",
            sourceEventId: evt.id,
            deviceId: evt.deviceId,
          },
        });
      }
    } catch (err: any) {
      if (err.code !== "P2002") throw err;
    }
  }

  return { resolved: matchedEvents.length };
}
