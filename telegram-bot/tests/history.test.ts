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

  // Round-5 regression: gpt-5 assistant messages carry `id` (msg_…) and
  // `providerData.reasoning_id` (rs_…) referencing server-side state.
  // Preserving those refs and replaying without the reasoning blob trips:
  //   "Item 'msg_…' of type 'message' was provided without its required
  //    'reasoning' item: 'rs_…'"
  // History must REBUILD items with text-only content, dropping ALL
  // metadata, to fully decouple from server-side reasoning state.
  it("STRIPS id and providerData from assistant messages (gpt-5 reasoning crash)", () => {
    const items: AgentInputItem[] = [
      {
        role: "user",
        content: [{ type: "input_text", text: "how much in april?" }],
        id: "msg_user_xyz",
        providerData: { request_id: "req_123" },
      } as any,
      {
        role: "assistant",
        status: "completed",
        id: "msg_091c7b53e90b933e006a0b69b9632c81909d6ab23f7e302740",
        providerData: { reasoning_id: "rs_091c7b53e90b933e006a0b69b1d404819096e9fd6a415bc7ea" },
        content: [{ type: "output_text", text: "₹5,67,297" }],
      } as any,
    ];
    const out = keepConversationalOnly(items);
    expect(out).toHaveLength(2);
    for (const item of out) {
      const o = item as any;
      expect(o.id).toBeUndefined();
      expect(o.providerData).toBeUndefined();
      expect(o.status).toBeUndefined();
      // Content is preserved as a clean text array.
      expect(Array.isArray(o.content)).toBe(true);
      expect(o.content[0]?.text).toBeTruthy();
    }
    expect((out[0] as any).content[0].text).toContain("april");
    expect((out[1] as any).content[0].text).toContain("₹5,67,297");
  });

  it("rebuilds user item from plain string content", () => {
    const items: AgentInputItem[] = [
      { role: "user", content: "plain string question", id: "msg_x" } as any,
    ];
    const out = keepConversationalOnly(items);
    expect(out).toHaveLength(1);
    const o = out[0] as any;
    expect(o.id).toBeUndefined();
    expect(o.content[0].text).toBe("plain string question");
  });

  it("drops items whose text content is empty after stripping", () => {
    const items: AgentInputItem[] = [
      { role: "user", content: [] } as any,
      { role: "assistant", status: "completed", content: [{ type: "refusal", refusal: "..." }] } as any,
    ];
    expect(keepConversationalOnly(items)).toEqual([]);
  });
});
