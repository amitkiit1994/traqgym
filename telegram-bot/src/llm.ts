import type { GoogleGenAI, Content, GenerateContentResponse } from "@google/genai";
import type { BlobStore } from "./data/blob-store.js";
import { parseCsv } from "./data/csv-parse.js";
import { buildListCsvsResult, CSV_HINTS } from "./tools/list-csvs.js";
import { LIST_CSVS_DECL, QUERY_CSV_DECL, parseQueryArgs } from "./tools/schema.js";
import { applyQuery } from "./tools/query-csv.js";

export interface RunLlmInput {
  question: string;
  ai: GoogleGenAI;
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
- list_csvs: see what data exists with EXACT column names and sample rows.
- query_csv: query one CSV with filters / group_by / agg.

Process (follow strictly):
1. ALWAYS call list_csvs FIRST for any data question, to get exact CSV names and
   exact column names. Column names are case-sensitive and contain spaces
   (e.g. "Payment Mode", "Paid Amount", "Billing Name"). Never guess.
2. Then call query_csv using the exact names from list_csvs.
3. If query_csv returns an error, read the "hint" field — it lists valid options.
   Re-call with corrected args. Do NOT give up after one error.

Rules:
- NEVER ask the user a clarifying question. Always compute the answer with the
  best interpretation and state your assumption in one short sentence.
- After list_csvs, you MUST call query_csv to compute the answer. Do not stop
  after list_csvs alone — that returns metadata, not the answer.
- All money is in Indian rupees, formatted with Indian commas (₹3,05,700).
- Today's date is ${todayIso}. Snapshot date is ${snapshot}.
- If the answer requires data not in the CSVs, say so plainly.
- Keep replies short. End with: "📅 data as of ${snapshot}".
`.trim();

export async function runLlm(input: RunLlmInput): Promise<RunLlmResult> {
  const { ai, model, store, question } = input;
  const maxIter = input.maxIterations ?? 5;
  const pointer = await store.fetchLatest();
  const todayIso = new Date().toISOString().slice(0, 10);

  const contents: Content[] = [
    { role: "user", parts: [{ text: question }] },
  ];

  let toolCalls = 0;
  for (let i = 0; i < maxIter; i++) {
    const resp: GenerateContentResponse = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt(pointer.snapshot_date, todayIso),
        tools: [{ functionDeclarations: [LIST_CSVS_DECL, QUERY_CSV_DECL] }],
      },
    });

    const candidate = resp.candidates?.[0];
    const modelParts = candidate?.content?.parts ?? [];
    contents.push({ role: "model", parts: modelParts });

    const fnCalls = modelParts.filter(p => p.functionCall);
    if (fnCalls.length === 0) {
      const text = modelParts.map(p => p.text ?? "").join("").trim();
      return { text, toolCalls, snapshotDate: pointer.snapshot_date };
    }

    const responseParts: Content["parts"] = [];
    for (const part of fnCalls) {
      const call = part.functionCall!;
      toolCalls++;
      const name = call.name ?? "";
      const args = call.args ?? {};
      let response: Record<string, unknown>;
      try {
        if (name === "list_csvs") {
          response = await buildListCsvsResult(store) as unknown as Record<string, unknown>;
        } else if (name === "query_csv") {
          const parsed = parseQueryArgs(args);
          const hint = CSV_HINTS[parsed.csv] ?? { date: [], number: [] };
          const text = await store.fetchCsv(parsed.csv);
          const { rows } = parseCsv(text, {
            dateColumns: hint.date,
            numberColumns: hint.number,
          });
          response = applyQuery(rows, parsed) as unknown as Record<string, unknown>;
        } else {
          response = { error: `Unknown tool: ${name}` };
        }
      } catch (e) {
        response = { error: (e as Error).message };
      }
      responseParts!.push({ functionResponse: { name, response } });
    }
    contents.push({ role: "user", parts: responseParts });
  }
  return {
    text: "I couldn't figure out how to answer that — try rephrasing.",
    toolCalls,
    snapshotDate: pointer.snapshot_date,
  };
}
