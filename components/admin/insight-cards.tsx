/**
 * Server component — fetches active insights and renders glass-effect cards
 * grouped by severity. Interactive controls (dismiss / snooze / action chips)
 * live in the InsightCardsClient sibling.
 */

import { listActiveInsights } from "@/lib/services/insight";
import { InsightCardsClient, type InsightCardData } from "./insight-cards-client";

export async function InsightCards({ limit = 6 }: { limit?: number }) {
  const insights = await listActiveInsights({ limit });
  if (insights.length === 0) return null;

  const data: InsightCardData[] = insights.map((i) => ({
    id: i.id,
    agent: i.agent,
    severity: i.severity,
    title: i.title,
    body: i.body,
    suggestedActions: Array.isArray(i.suggestedActions)
      ? (i.suggestedActions as InsightCardData["suggestedActions"])
      : [],
    createdAt: i.createdAt.toISOString(),
  }));

  return <InsightCardsClient insights={data} />;
}
