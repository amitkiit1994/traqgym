import type { AgentInputItem } from "@openai/agents";

/**
 * Rebuild conversation history with ONLY text content — drop every piece
 * of metadata the OpenAI Responses API might use to look up server-side
 * state (reasoning blobs, tool-call IDs, message IDs, providerData refs).
 *
 * Why this is more aggressive than "filter to role: user|assistant":
 *
 * gpt-5 (and other reasoning models) attach metadata to assistant
 * messages — a `providerData.reasoning_id` pointing at the encrypted CoT
 * blob the server kept. The Agents SDK doesn't request that blob back by
 * default, so on replay the Responses API 400s with:
 *
 *   "Item 'msg_…' of type 'message' was provided without its required
 *    'reasoning' item: 'rs_…'"
 *
 * Earlier fixes stripped the function_call + reasoning items but kept
 * the assistant message verbatim — including its `id` and `providerData`
 * — which still trip this constraint. Rebuilding the items from scratch
 * with only their plain text content fully decouples replayed history
 * from any server-side reasoning state.
 *
 * The conversation flow that mattered (user → bot text reply) is fully
 * preserved; the agent re-derives any needed tool calls fresh.
 */
export function keepConversationalOnly(items: AgentInputItem[]): AgentInputItem[] {
  const out: AgentInputItem[] = [];
  for (const item of items) {
    const role = (item as { role?: unknown }).role;
    if (role === "user") {
      const text = extractText(item, ["input_text", "text"]);
      if (text) out.push(buildUserItem(text));
    } else if (role === "assistant") {
      const text = extractText(item, ["output_text", "text"]);
      if (text) out.push(buildAssistantItem(text));
    }
    // All other roles (system, reasoning, function_call, etc.) are dropped.
  }
  return out;
}

function extractText(item: AgentInputItem, accepted: string[]): string | null {
  const content = (item as { content?: unknown }).content;
  if (typeof content === "string") return content.trim() || null;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content as Array<{ type?: string; text?: string }>) {
      if (c && typeof c.text === "string" && c.type && accepted.includes(c.type)) {
        parts.push(c.text);
      }
    }
    const joined = parts.join("\n").trim();
    return joined || null;
  }
  return null;
}

function buildUserItem(text: string): AgentInputItem {
  return {
    role: "user",
    content: [{ type: "input_text", text }],
  } as unknown as AgentInputItem;
}

function buildAssistantItem(text: string): AgentInputItem {
  return {
    role: "assistant",
    content: [{ type: "output_text", text }],
  } as unknown as AgentInputItem;
}
