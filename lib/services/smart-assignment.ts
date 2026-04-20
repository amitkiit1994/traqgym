import { getDailyActions, ActionItem } from "./daily-actions";
import { getSetting } from "./settings";
import { runProactiveAgent } from "@/lib/ai/proactive-runner";
import { prisma } from "@/lib/prisma";

export type SmartActionItem = ActionItem & {
  suggestion?: string;
};

// Simple in-memory cache with 1-hour TTL
const smartTaskCache = new Map<string, { items: SmartActionItem[]; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function getSmartDailyActions(workerId?: number): Promise<SmartActionItem[]> {
  const items = await getDailyActions();

  const enabled = await getSetting("ai_smart_tasks_enabled", "false");
  if (enabled !== "true" || !workerId) {
    return items;
  }

  // Check cache (keyed by worker + hour)
  const cacheKey = `smart_tasks_${workerId}_${new Date().toISOString().slice(0, 13)}`;
  const cached = smartTaskCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.items;
  }

  try {
    // Fetch worker info for context
    const worker = await prisma.worker.findUnique({
      where: { id: workerId },
      select: { firstname: true, lastname: true, role: true },
    });

    if (!worker) {
      return items;
    }

    const itemSummary = items
      .map((i) => `- ${i.label}: ${i.count} (priority: ${i.priority})`)
      .join("\n");

    // IST calendar date for cache key
    const todayStr = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

    const prompt = `Today is ${todayStr}. You are helping ${worker.firstname} ${worker.lastname} (role: ${worker.role}).

Here are today's action items:
${itemSummary}

Instructions:
1. Rank these items by urgency and revenue impact (most urgent first).
2. For each item, add a short 1-line actionable suggestion.

Respond in JSON format only:
[
  { "type": "<action type>", "suggestion": "<1-line suggestion>" },
  ...
]

Include ALL items. Only output the JSON array, no other text.`;

    const result = await runProactiveAgent({
      feature: "smart_tasks",
      prompt,
      allowedToolNames: [], // No tools needed, just reasoning
    });

    // Parse AI response
    const jsonMatch = result.output.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return items;
    }

    const ranked: { type: string; suggestion: string }[] = JSON.parse(jsonMatch[0]);

    // Merge AI suggestions into items, preserving AI ranking order
    const enhancedItems: SmartActionItem[] = [];
    const itemMap = new Map(items.map((i) => [i.type as string, i]));

    for (const r of ranked) {
      const original = itemMap.get(r.type);
      if (original) {
        enhancedItems.push({ ...original, suggestion: r.suggestion });
        itemMap.delete(r.type);
      }
    }

    // Append any items AI missed (shouldn't happen, but safety)
    for (const remaining of itemMap.values()) {
      enhancedItems.push(remaining);
    }

    // Cache result
    smartTaskCache.set(cacheKey, { items: enhancedItems, ts: Date.now() });

    return enhancedItems;
  } catch (error) {
    console.error("Smart tasks AI failed, falling back to basic list:", error);
    return items;
  }
}
