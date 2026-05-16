import { Agent, run, tool, user } from "@openai/agents";
import type { AgentInputItem } from "@openai/agents";
import { z } from "zod";
import type { BlobStore } from "./data/blob-store.js";
import { parseCsv } from "./data/csv-parse.js";
import { buildListCsvsResult, CSV_HINTS } from "./tools/list-csvs.js";
import { applyQuery } from "./tools/query-csv.js";

export interface RunLlmInput {
  question: string;
  model: string;
  store: BlobStore;
  history?: AgentInputItem[];
  maxIterations?: number;
}

export interface RunLlmResult {
  text: string;
  toolCalls: number;
  snapshotDate: string;
  history: AgentInputItem[];
}

const systemPrompt = (snapshot: string, todayIso: string) => `
You are a data analyst for Free Form Fitness gym. Answer questions using ONLY the
data returned by your tools. Never invent numbers.

Tools:
- list_csvs: returns exact CSV names and exact column names. Call FIRST for any
  data question. Column names are case-sensitive and contain spaces (e.g.
  "Payment Mode", "Paid Amount", "Billing Name"). Never guess.
- query_csv: run filters / group_by / agg against one CSV.

Rules:
- NEVER ask the user a clarifying question. Make the best interpretation and state
  your assumption in one short sentence if needed.
- After list_csvs you MUST call query_csv to compute the answer; list_csvs alone
  returns metadata, not the answer.
- If query_csv returns an error, read the "hint" field — it lists valid options —
  and re-call with corrected args. Do not give up after one error.
- All money is in Indian rupees, formatted with Indian commas (₹3,05,700).
- Today's date is ${todayIso}. Snapshot date is ${snapshot}.
- If the answer needs data not in the CSVs, say so plainly.
- Keep replies short. End with: "📅 data as of ${snapshot}".
`.trim();

// Strict-mode-friendly flat schema. The DSL executor maps these fields back
// into the richer Filter union (see normalizeFilter below). Values are always
// strings here; cmp() in query-csv.ts coerces to numbers/dates as needed.
const flatFilter = z.object({
  col: z.string(),
  op: z.enum(["eq","neq","gt","gte","lt","lte","icontains","between","in","isblank","notblank"]),
  val: z.string().nullable(),                  // for eq/neq/gt/lt/icontains
  val_to: z.string().nullable(),               // for between (paired with val)
  val_list: z.array(z.string()).nullable(),    // for "in"
});

const queryArgs = z.object({
  csv: z.string(),
  filters: z.array(flatFilter).nullable(),
  group_by: z.array(z.string()).nullable(),
  agg: z.object({
    col: z.string(),
    fn: z.enum(["sum","count","avg","min","max"]),
  }).nullable(),
  select: z.array(z.string()).nullable(),
  order_by: z.object({
    col: z.string(),
    dir: z.enum(["asc","desc"]),
  }).nullable(),
  limit: z.number().int().positive().max(200).nullable(),
});

type FlatFilter = z.infer<typeof flatFilter>;
type FlatQueryArgs = z.infer<typeof queryArgs>;

function normalizeFilter(f: FlatFilter): import("./tools/query-csv.js").Filter {
  switch (f.op) {
    case "between":
      return { col: f.col, op: "between", val: [f.val ?? "", f.val_to ?? ""] };
    case "in":
      return { col: f.col, op: "in", val: f.val_list ?? [] };
    case "isblank":
    case "notblank":
      return { col: f.col, op: f.op };
    default:
      return { col: f.col, op: f.op, val: f.val };
  }
}

function buildTools(store: BlobStore, counter: { n: number }) {
  const listCsvs = tool({
    name: "list_csvs",
    description: "List all available CSVs with exact column names and a few sample rows. Call this FIRST.",
    parameters: z.object({}),
    execute: async () => {
      counter.n++;
      return await buildListCsvsResult(store);
    },
  });

  const queryCsv = tool({
    name: "query_csv",
    description:
      "Query one CSV with filters / group_by / agg. Use exact names from list_csvs. " +
      "For filter ops: use 'val' for eq/neq/gt/gte/lt/lte/icontains. " +
      "Use 'val' AND 'val_to' for 'between' (val = lower bound, val_to = upper bound). " +
      "Use 'val_list' for 'in'. Use neither for 'isblank'/'notblank'.",
    parameters: queryArgs,
    execute: async (args: FlatQueryArgs) => {
      counter.n++;
      const hint = CSV_HINTS[args.csv] ?? { date: [], number: [] };
      const text = await store.fetchCsv(args.csv);
      const { rows } = parseCsv(text, { dateColumns: hint.date, numberColumns: hint.number });
      return applyQuery(rows, {
        filters: args.filters?.map(normalizeFilter),
        group_by: args.group_by ?? undefined,
        agg: args.agg ?? undefined,
        select: args.select ?? undefined,
        order_by: args.order_by ?? undefined,
        limit: args.limit ?? undefined,
      });
    },
  });

  return [listCsvs, queryCsv];
}

export async function runLlm(input: RunLlmInput): Promise<RunLlmResult> {
  const { model, store, question } = input;
  const maxTurns = input.maxIterations ?? 5;
  const pointer = await store.fetchLatest();
  const todayIso = new Date().toISOString().slice(0, 10);

  const counter = { n: 0 };
  const agent = new Agent({
    name: "FreeForm data analyst",
    instructions: systemPrompt(pointer.snapshot_date, todayIso),
    model,
    tools: buildTools(store, counter),
  });

  // Combine prior conversation history (if any) with the new user turn.
  const priorHistory = input.history ?? [];
  const turnInput: AgentInputItem[] = [...priorHistory, user(question)];

  try {
    const result = await run(agent, turnInput, { maxTurns });
    const text = result.finalOutput?.toString().trim() ?? "";
    return {
      text,
      toolCalls: counter.n,
      snapshotDate: pointer.snapshot_date,
      history: result.history,
    };
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (msg.toLowerCase().includes("maxturn")) {
      return {
        text: "I couldn't figure out how to answer that — try rephrasing.",
        toolCalls: counter.n,
        snapshotDate: pointer.snapshot_date,
        history: priorHistory,
      };
    }
    throw e;
  }
}
