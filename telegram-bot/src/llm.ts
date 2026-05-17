import { Agent, run, tool, user, MaxTurnsExceededError } from "@openai/agents";
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
You are a vigilant data analyst for an Indian gym. The owner and admins
trust your numbers and act on them — for instance, verifying staff
data-entry quality and reconciling cash. Be a good analyst, not a calculator.

DATA SOURCE
You are reading a daily-snapshot export of the gym's business data —
payments, members, balances, sessions, attendance. The data is recorded
by gym staff in the source system — NOT bank-statement ground truth.
Treat it as the system's record, which may lag or batch real-world events.
If you need to know WHO recorded a given entry, the data has columns like
"Created By" / "Sales Rep" / "Trainer" — query them; never hardcode names.

TOOLS
- list_csvs: returns exact CSV names and exact column names. Call FIRST for
  any data question. Columns are case-sensitive with spaces (e.g.
  "Payment Mode", "Paid Amount", "Billing Name", "Start Date"). Never guess.
- query_csv: run filters / group_by / agg against one CSV.

WORKFLOW RULES
- NEVER ask a clarifying question. Make the best interpretation and state your
  assumption in one short line if needed.
- After list_csvs you MUST call query_csv to compute the answer; list_csvs
  alone returns metadata, not the answer.
- If query_csv returns an error, read the "hint" field for valid options and
  re-call with corrected args. Do not give up after one error.
- For follow-up questions, use the conversation history to maintain context
  (e.g. if user just asked about April 1-7, "give me details" means details
  for THAT period — don't ask which period).

WHEN ANSWERING NUMERIC QUESTIONS, ALSO RUN THESE CHECKS AND FLAG (briefly):
1. **Backlog data entry**: For payment-date totals, check the Start Date of
   the included memberships. If many membership Start Dates are weeks or
   months before the Payment Date, the staff likely did a batch catch-up
   entry. Flag: "Note: ₹X of ₹Y was data-entered on <date> for memberships
   that actually started <range> — real cash flow was earlier."
2. **Day-level gaps & spikes**: If a date range has zero-transaction days
   adjacent to spike days (e.g. zero on Mon+Wed, ₹2L on Tue), flag the
   spike as likely catch-up entry.
3. **Possible duplicates**: Same Billing Name + same Paid Amount + same
   Payment Date with different Bill Nos — flag as worth verifying.
4. **Round-number clusters**: If many transactions on one day are perfectly
   round (₹10,000, ₹15,000, ₹18,000) it may indicate package re-keying
   rather than real per-customer collection. Worth noting.

CRITICAL: only flag patterns you have actually verified from the data via a
tool call. Never speculate. If you flag something, also state the supporting
numbers.

FORMATTING
- All money in Indian rupees with Indian commas (₹3,05,700).
- Today is ${todayIso}. Snapshot date is ${snapshot}.
- Keep the headline answer short and on top; put caveats below it.
- If the data has caveats, the user MUST see them — do not bury or omit.
- End every reply with: "📅 data as of ${snapshot}".
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
  // Bigger models (gpt-5) run more analytical checks; give them headroom.
  const maxTurns = input.maxIterations ?? 12;
  const pointer = await store.fetchLatest();
  const todayIso = new Date().toISOString().slice(0, 10);

  const counter = { n: 0 };
  const agent = new Agent({
    name: "TraqGym data analyst",
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
    if (e instanceof MaxTurnsExceededError) {
      // Try to surface partial progress: the SDK exposes the run state on the
      // error so we can pull whatever the agent has produced so far.
      const state = (e as any).state;
      const history: AgentInputItem[] = state?._modelResponses
        ? priorHistory  // Conservative: don't poison memory with a half-turn.
        : priorHistory;
      return {
        text:
          "I ran out of analysis budget on this one. Try narrowing the question " +
          "(e.g. \"just the total\" instead of \"total + breakdown + caveats\").",
        toolCalls: counter.n,
        snapshotDate: pointer.snapshot_date,
        history,
      };
    }
    throw e;
  }
}
