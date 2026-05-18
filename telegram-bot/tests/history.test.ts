import { describe, it, expect } from "vitest";
import type { AgentInputItem } from "@openai/agents";
import { keepConversationalOnly } from "../src/history.js";

describe("keepConversationalOnly", () => {
  it("keeps user and assistant message items", () => {
    const items: AgentInputItem[] = [
      { role: "user", content: "how much collected 1 to 7 april?" } as any,
      {
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "₹3,05,700" }],
      } as any,
    ];
    expect(keepConversationalOnly(items)).toHaveLength(2);
  });

  it("drops reasoning, function_call, and function_call_output items", () => {
    const items: AgentInputItem[] = [
      { role: "user", content: "how much collected?" } as any,
      { type: "reasoning", id: "rs_1", content: [] } as any,
      {
        type: "function_call",
        id: "fc_1",
        callId: "call_1",
        name: "list_csvs",
        arguments: "{}",
      } as any,
      {
        type: "function_call_result",
        id: "fco_1",
        callId: "call_1",
        output: "{}",
        status: "completed",
      } as any,
      {
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "₹3,05,700" }],
      } as any,
    ];
    const out = keepConversationalOnly(items);
    expect(out).toHaveLength(2);
    expect((out[0] as any).role).toBe("user");
    expect((out[1] as any).role).toBe("assistant");
  });

  it("breaks fc_/rs_ pairing by removing both — leaves no orphan function_call", () => {
    // Regression for the OpenAI Responses API 400:
    //   "Item 'fc_…' was provided without its required 'reasoning' item: 'rs_…'"
    const items: AgentInputItem[] = [
      { role: "user", content: "q" } as any,
      { type: "reasoning", id: "rs_1", content: [] } as any,
      {
        type: "function_call",
        id: "fc_1",
        callId: "call_1",
        name: "query_csv",
        arguments: "{}",
      } as any,
      {
        type: "function_call_result",
        id: "fco_1",
        callId: "call_1",
        output: "{}",
        status: "completed",
      } as any,
      {
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "a" }],
      } as any,
      { role: "user", content: "follow-up" } as any,
    ];
    const out = keepConversationalOnly(items);
    const hasFunctionCall = out.some(i => (i as any).type === "function_call");
    const hasReasoning = out.some(i => (i as any).type === "reasoning");
    expect(hasFunctionCall).toBe(false);
    expect(hasReasoning).toBe(false);
    expect(out).toHaveLength(3);
  });

  it("returns empty array when no conversational items present", () => {
    const items: AgentInputItem[] = [
      { type: "reasoning", id: "rs_1", content: [] } as any,
      {
        type: "function_call",
        id: "fc_1",
        callId: "call_1",
        name: "x",
        arguments: "{}",
      } as any,
    ];
    expect(keepConversationalOnly(items)).toEqual([]);
  });

  it("preserves multimodal user content (text + image)", () => {
    const items: AgentInputItem[] = [
      {
        role: "user",
        content: [
          { type: "input_text", text: "what's this?" },
          { type: "input_image", image_url: "data:image/jpeg;base64,xxx", detail: "auto" },
        ],
      } as any,
    ];
    expect(keepConversationalOnly(items)).toHaveLength(1);
  });
});
