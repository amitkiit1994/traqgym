import type { AgentInputItem } from "@openai/agents";

/**
 * Strip the agent's scratchpad (reasoning, function_call, function_call_output)
 * from history so only conversational turns survive into the next request.
 *
 * Why: gpt-5 (and other reasoning models) require every replayed `function_call`
 * to be paired with its preceding `reasoning` item — INCLUDING the server's
 * encrypted CoT blob, which the Agents SDK does not request back by default.
 * Replaying scratchpad without that blob trips a 400 from the Responses API:
 *   "Item 'fc_…' of type 'function_call' was provided without its required
 *    'reasoning' item: 'rs_…'"
 *
 * For a follow-up like "give me details" the model only needs to see what was
 * said, not how it was computed — it'll re-run the tools fresh.
 */
export function keepConversationalOnly(items: AgentInputItem[]): AgentInputItem[] {
  return items.filter(isConversationalMessage);
}

function isConversationalMessage(item: AgentInputItem): boolean {
  const role = (item as { role?: unknown }).role;
  return role === "user" || role === "assistant";
}
