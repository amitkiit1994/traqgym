import type OpenAI from "openai";
import type { BlobStore } from "./data/blob-store.js";
import { parseCsv } from "./data/csv-parse.js";
import { buildListCsvsResult, CSV_HINTS } from "./tools/list-csvs.js";
import { LIST_CSVS_TOOL, QUERY_CSV_TOOL, parseQueryArgs } from "./tools/schema.js";
import { applyQuery } from "./tools/query-csv.js";

export interface RunLlmInput {
  question: string;
  openai: OpenAI;
  model: string;
  store: BlobStore;
  maxIterations?: number;
}

export interface RunLlmResult {
  text: string;
  toolCalls: number;
  snapshotDate: string;
}

const systemPrompt = (snapshot: string, todayIso: string) => `
You are a data analyst for Free Form Fitness gym. Answer the user's question using ONLY the
data returned by your tools. Never make up numbers.

Tools:
- list_csvs: see what data exists. Call first if you are unsure of CSV names or columns.
- query_csv: query one CSV with filters / group_by / agg.

Rules:
- All money is in Indian rupees, formatted with Indian commas (₹3,05,700).
- Today's date is ${todayIso}. Snapshot date is ${snapshot}.
- If the answer requires data not in the CSVs, say so plainly.
- Keep replies short. End with: "📅 data as of ${snapshot}".
- If the question is ambiguous (e.g. "this week" without specifying), pick the most likely
  interpretation and state it briefly.
`.trim();

export async function runLlm(input: RunLlmInput): Promise<RunLlmResult> {
  const { openai, model, store, question } = input;
  const maxIter = input.maxIterations ?? 5;
  const pointer = await store.fetchLatest();
  const todayIso = new Date().toISOString().slice(0, 10);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(pointer.snapshot_date, todayIso) },
    { role: "user", content: question },
  ];

  let toolCalls = 0;
  for (let i = 0; i < maxIter; i++) {
    const resp = await openai.chat.completions.create({
      model,
      messages,
      tools: [LIST_CSVS_TOOL, QUERY_CSV_TOOL],
      tool_choice: "auto",
    });
    const msg = resp.choices[0]!.message;
    messages.push(msg as OpenAI.Chat.ChatCompletionMessageParam);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { text: msg.content ?? "", toolCalls, snapshotDate: pointer.snapshot_date };
    }

    for (const call of msg.tool_calls) {
      toolCalls++;
      let content: string;
      try {
        if (call.function.name === "list_csvs") {
          const r = await buildListCsvsResult(store);
          content = JSON.stringify(r);
        } else if (call.function.name === "query_csv") {
          const args = parseQueryArgs(JSON.parse(call.function.arguments));
          const hint = CSV_HINTS[args.csv] ?? { date: [], number: [] };
          const text = await store.fetchCsv(args.csv);
          const { rows } = parseCsv(text, {
            dateColumns: hint.date,
            numberColumns: hint.number,
          });
          content = JSON.stringify(applyQuery(rows, args));
        } else {
          content = JSON.stringify({ error: `Unknown tool: ${call.function.name}` });
        }
      } catch (e) {
        content = JSON.stringify({ error: (e as Error).message });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  return {
    text: "I couldn't figure out how to answer that — try rephrasing.",
    toolCalls,
    snapshotDate: pointer.snapshot_date,
  };
}
