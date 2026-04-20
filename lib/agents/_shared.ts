/**
 * Shared agent helpers — Insight upsert.
 *
 * Writes to the dedicated `Insight` table (PR 3). Dedupe is enforced via the
 * `dedupeKey` unique constraint, so re-running an agent within the same window
 * (e.g. comp_auditor for a given date) updates the existing row instead of
 * creating duplicates.
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
  /** Legacy field from the InAppNotification stand-in. Ignored — Insights are
   *  global (not per-recipient). Kept here so existing agent callers compile. */
  recipientWorkerIds?: number[];
};

/**
 * Upsert an insight by `dedupeKey`. Returns:
 *   - `created: true`  if a new row was inserted
 *   - `created: false` if an existing row was refreshed
 */
export async function upsertInsight(
  input: InsightInput
): Promise<{ created: boolean; insightId: number }> {
  const data = {
    agent: input.agent,
    severity: input.severity,
    title: input.title,
    body: input.body,
    dataJson: (input.dataJson ?? null) as never,
    suggestedActions: (input.suggestedActions ?? null) as never,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
  };

  // Check existence first so we can report `created` accurately. The unique
  // constraint on dedupeKey still guards against races (upsert is atomic).
  const existing = await prisma.insight.findUnique({
    where: { dedupeKey: input.dedupeKey },
    select: { id: true },
  });

  const row = await prisma.insight.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: {
      ...data,
      dedupeKey: input.dedupeKey,
    },
    update: {
      // Refresh the human-readable payload + data on re-emit so the user sees
      // the latest counts. Do NOT touch dismissedAt/snoozedUntil.
      severity: data.severity,
      title: data.title,
      body: data.body,
      dataJson: data.dataJson,
      suggestedActions: data.suggestedActions,
      entityType: data.entityType,
      entityId: data.entityId,
    },
    select: { id: true },
  });

  return { created: !existing, insightId: row.id };
}
