import { describe, it, expect, vi } from "vitest";
import { runLlm } from "../src/llm.js";
import type { BlobStore } from "../src/data/blob-store.js";

const pointer = {
  snapshot_date: "2026-05-16",
  snapshot_ist: "2026-05-16T06:02:11+05:30",
  row_counts: { payments: 3 },
  blob_urls: { payments: "https://blob.example/p.csv" },
};
const payCsv =
  "Payment Date,Billing Name,Payment Mode,Paid Amount\n" +
  "01-04-2026,saba,Cash,2000\n02-04-2026,sanal,Cash,600\n04-04-2026,viral,Gpay,15000\n";

function makeStore(): BlobStore {
  return {
    fetchLatest: vi.fn().mockResolvedValue(pointer),
    fetchCsv: vi.fn().mockResolvedValue(payCsv),
  };
}

describe("runLlm", () => {
  it("returns final assistant text after tool calls", async () => {
    let callIdx = 0;
    const openai = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async () => {
            callIdx++;
            if (callIdx === 1) {
              return {
                choices: [{
                  message: {
                    role: "assistant",
                    tool_calls: [{
                      id: "t1",
                      type: "function",
                      function: {
                        name: "query_csv",
                        arguments: JSON.stringify({
                          csv: "payments",
                          filters: [{ col: "Payment Mode", op: "eq", val: "Cash" }],
                          agg: { col: "Paid Amount", fn: "sum" },
                        }),
                      },
                    }],
                  },
                }],
              };
            }
            return {
              choices: [{
                message: { role: "assistant", content: "Cash collections: ₹2,600" },
              }],
            };
          }),
        },
      },
    } as any;

    const result = await runLlm({
      question: "how much cash collected?",
      openai,
      model: "gpt-4o-mini",
      store: makeStore(),
      maxIterations: 5,
    });
    expect(result.text).toContain("₹2,600");
    expect(result.toolCalls).toBe(1);
  });

  it("stops after maxIterations and returns fallback", async () => {
    const openai = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{
              message: {
                role: "assistant",
                tool_calls: [{
                  id: "x",
                  type: "function",
                  function: { name: "list_csvs", arguments: "{}" },
                }],
              },
            }],
          }),
        },
      },
    } as any;

    const result = await runLlm({
      question: "loop forever",
      openai,
      model: "gpt-4o-mini",
      store: makeStore(),
      maxIterations: 3,
    });
    expect(result.text).toMatch(/couldn't figure out/i);
  });
});
