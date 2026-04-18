/**
 * Shared agent helpers — Insight upsert.
 *
 * NOTE: The dedicated Insight table lands in PR 3. Until then, this writes to
 * InAppNotification (workerId-targeted) with `type:"insight"`. Dedupe is encoded
 * as a `[KEY:<dedupeKey>]` prefix on the title, so we can detect existing rows
 * via a `startsWith` lookup.
 *
 * TODO(PR-3-insight-table): replace InAppNotification writes with first-class
 * Insight rows + ON CONFLICT dedupe.
 */

import { prisma } from "@/lib/prisma";

export type InsightSeverity = "critical" | "high" | "medium" | "low";

export type InsightInput = {
  agent: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  dataJson?: Record<string, unknown>;
  suggestedActions?: Array<{
    label: string;
    action: string;
    args: Record<string, unknown>;
  }>;
  entityType?: string;
  entityId?: number;
  dedupeKey: string;
  recipientWorkerIds?: number[];
};

const KEY_PREFIX = (dedupeKey: string) => `[KEY:${dedupeKey}]`;

function buildTitle(input: InsightInput): string {
  return `${KEY_PREFIX(input.dedupeKey)} ${input.title}`.slice(0, 500);
}

function buildMessage(input: InsightInput): string {
  const parts: string[] = [];
  parts.push(`[${input.severity.toUpperCase()}] ${input.body}`);
  if (input.suggestedActions && input.suggestedActions.length > 0) {
    parts.push(
      `\nActions: ${input.suggestedActions.map((a) => a.label).join(", ")}`
    );
  }
  if (input.dataJson && Object.keys(input.dataJson).length > 0) {
    try {
      parts.push(`\nData: ${JSON.stringify(input.dataJson)}`);
    } catch {
      // ignore
    }
  }
  if (input.entityType && input.entityId) {
    parts.push(`\nEntity: ${input.entityType}#${input.entityId}`);
  }
  return parts.join("");
}

function buildLink(input: InsightInput): string | undefined {
  if (input.entityType === "MemberTicket" && input.entityId) {
    return `/admin/comps?ticketId=${input.entityId}`;
  }
  if (input.entityType === "CompPass" && input.entityId) {
    return `/admin/comps?passId=${input.entityId}`;
  }
  if (input.agent === "comp_auditor") {
    return "/admin/comps";
  }
  return undefined;
}

/**
 * Upsert an insight. Returns `created: true` if at least one new row was inserted
 * (dedupe miss); `created: false` if every recipient already had this dedupeKey.
 */
export async function upsertInsight(
  input: InsightInput
): Promise<{ created: boolean }> {
  // Resolve recipient workers — explicit list, or all active admins.
  let workerIds: number[];
  if (input.recipientWorkerIds && input.recipientWorkerIds.length > 0) {
    workerIds = input.recipientWorkerIds;
  } else {
    const admins = await prisma.worker.findMany({
      where: { role: "admin", isActive: true },
      select: { id: true },
    });
    workerIds = admins.map((w) => w.id);
  }

  if (workerIds.length === 0) {
    return { created: false };
  }

  const title = buildTitle(input);
  const message = buildMessage(input);
  const link = buildLink(input);
  const titlePrefix = KEY_PREFIX(input.dedupeKey);

  // For each recipient, check if a notification with the same dedupeKey
  // prefix already exists; only insert if not.
  let created = false;
  for (const workerId of workerIds) {
    const existing = await prisma.inAppNotification.findFirst({
      where: {
        workerId,
        type: "insight",
        title: { startsWith: titlePrefix },
      },
      select: { id: true },
    });

    if (existing) continue;

    await prisma.inAppNotification.create({
      data: {
        workerId,
        type: "insight",
        title,
        message,
        link,
      },
    });
    created = true;
  }

  return { created };
}
