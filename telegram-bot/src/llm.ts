import { Agent, run, tool, user, MaxTurnsExceededError } from "@openai/agents";
import type { AgentInputItem } from "@openai/agents";
import { z } from "zod";
import { BlobStoreRegistry } from "./data/blob-store.js";
import { parseCsv } from "./data/csv-parse.js";
import { buildListCsvsResult, CSV_HINTS } from "./tools/list-csvs.js";
import { applyQuery } from "./tools/query-csv.js";
import { listGyms, isValidGymSlug } from "./gyms.js";

export interface RunLlmInput {
  question: string;
  model: string;
  registry: BlobStoreRegistry;
  history?: AgentInputItem[];
  maxIterations?: number;
  imageUrls?: string[];
}

export interface RunLlmResult {
  text: string;
  toolCalls: number;
  /** ISO date strings keyed by gym slug. Useful for the "data as of"
   * footer when answers cover multiple gyms. */
  snapshotDates: Record<string, string>;
  history: AgentInputItem[];
}

const GYM_LIST_FOR_PROMPT = listGyms().map(g => `  - ${g.slug}: ${g.name}`).join("\n");

const systemPrompt = (snapshotsLine: string, todayIso: string) => `
You are a vigilant data analyst serving an Indian gym OWNER who runs multiple
gyms. The owner trusts your numbers and acts on them. Be a good analyst,
not a calculator.

GYMS YOU CAN ANSWER FOR
${GYM_LIST_FOR_PROMPT}

DATA SOURCE
For each gym you are reading a daily-snapshot export of that gym's business
data — payments, members, balances, sessions, attendance. The data is
recorded by gym staff in the source system — NOT bank-statement ground
truth. Treat it as the system's record, which may lag or batch real-world
events. If you need to know WHO recorded a given entry, the data has
columns like "Created By" / "Sales Rep" / "Trainer" — query them; never
hardcode names.

${snapshotsLine}

TOOLS (gym is REQUIRED in every data tool call)
- list_gyms: returns all available gyms with slugs + display names.
- list_csvs(gym): returns the exact CSV names + columns for that gym.
  Call FIRST for any data question. Column names are case-sensitive and
  contain spaces (e.g. "Payment Mode", "Paid Amount", "Billing Name").
- query_csv(gym, csv, ...): run filters / group_by / agg against one CSV
  of one gym.

MULTI-GYM RULES (CRITICAL)
- If the user names a gym ("FFF", "free form", "egym", "lokhandwala"), use
  that gym. Match against gym names case-insensitive — "fff" and "ffm" and
  "free form" all = freeform. "egym" and "lokhandwala" = egym.
- If the question is ambiguous about which gym (e.g. "cash today"), answer
  for BOTH gyms side-by-side. Compute each separately, present them
  together with clear section headers per gym.
- Each gym's snapshot may have a different date. Use each gym's actual
  snapshot date in answers about that gym.

UNAVAILABLE GYMS (HARD RULE)
- Look at the SNAPSHOTS block above. If a gym is marked UNAVAILABLE or
  (no snapshot yet — refuse data queries for this gym), you MUST NOT call
  list_csvs or query_csv for that gym. The tools will return an error if
  you try.
- If the user's question only names an unavailable gym, reply with one
  sentence: "Snapshot for <gym name> is unreachable right now — try
  again later." Do not invent numbers.
- If the user's question is ambiguous and at least one gym is available,
  answer only for the available gyms and add one line at the end: "Note:
  <unavailable gym name> data is unreachable right now."

WORKFLOW RULES
- NEVER ask a clarifying question. Make the best interpretation and state
  your assumption in one short line if needed.
- After list_csvs you MUST call query_csv to compute the answer.
- If query_csv returns an error, read the "hint" field and re-call.
- For follow-up questions, use conversation history. If the prior turn was
  about a specific gym, "give me details" means details for THAT gym.

WHEN ANSWERING NUMERIC QUESTIONS, ALSO RUN THESE CHECKS AND FLAG (per gym):
1. Backlog data entry: if many membership Start Dates are weeks before
   their Payment Date, flag as batch catch-up entry.
2. Day-level gaps & spikes: zero-then-spike clusters suggest catch-up.
3. Possible duplicates: same Billing Name + same Paid Amount + same date
   with different Bill Nos.
4. Round-number clusters: many transactions all perfectly round on one day.

Only flag patterns you have actually verified via a tool call. Never speculate.

NAMES NOT IDs
NEVER show "Member Id" values to the user. Member Id is internal. ALWAYS
show the person's name. Name columns to use:
- payments → "Billing Name"
- activeinactive / balance → "Member Name"
- members → "Name"
- database → "Prospect Name"
- member_details → "Name"

FORMATTING
- Plain text only. NO markdown (no **bold**, no _italic_, no \`code\`, no #
  headings). Use UPPER CASE labels + dashes for structure.
- When answering for multiple gyms, structure as:
      FREE FORM FITNESS
      <answer>

      EGYM LOKHANDWALA
      <answer>
- All money in Indian rupees with Indian commas (₹3,05,700).
- Today is ${todayIso}.
- Keep replies short. End with "📅 data as of <date>" per gym if dates
  differ, or a single footer if all the same.
`.trim();

// Strict-mode-friendly flat schema (same as before, but with optional gym arg).
const flatFilter = z.object({
  col: z.string(),
  op: z.enum(["eq","neq","gt","gte","lt","lte","icontains","between","in","isblank","notblank"]),
  val: z.string().nullable(),
  val_to: z.string().nullable(),
  val_list: z.array(z.string()).nullable(),
});

const queryArgs = z.object({
  gym: z.string(),  // REQUIRED: which gym to query
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
    case "between":  return { col: f.col, op: "between", val: [f.val ?? "", f.val_to ?? ""] };
    case "in":       return { col: f.col, op: "in", val: f.val_list ?? [] };
    case "isblank":
    case "notblank": return { col: f.col, op: f.op };
    default:         return { col: f.col, op: f.op, val: f.val };
  }
}

function buildTools(
  registry: BlobStoreRegistry,
  counter: { n: number },
  snapshots: Record<string, string>,
  snapshotsStructured: Record<string, SnapshotLoad>,
) {
  // Tool-level guard: if the system prompt's instruction to refuse
  // unavailable gyms is ignored by the model, this short-circuits the
  // call cleanly instead of producing an opaque fetch error mid-tool.
  function gymUnavailableError(gym: string): { error: string; hint: string } | null {
    const s = snapshotsStructured[gym];
    if (!s || s.status === "missing") {
      return {
        error: `Gym '${gym}' has no snapshot loaded yet.`,
        hint: `Tell the user: "Snapshot for ${gym} is unreachable — try again later." Do not retry.`,
      };
    }
    if (s.status === "error") {
      return {
        error: `Gym '${gym}' snapshot is currently unreachable: ${s.reason}`,
        hint: `Tell the user: "Snapshot for ${gym} is unreachable — try again later." Do not retry.`,
      };
    }
    return null;
  }

  const listGymsTool = tool({
    name: "list_gyms",
    description: "List all gyms the owner can query. Returns slug + display name for each.",
    parameters: z.object({}),
    execute: async () => {
      counter.n++;
      return { gyms: listGyms().map(g => ({ slug: g.slug, name: g.name })) };
    },
  });

  const listCsvsTool = tool({
    name: "list_csvs",
    description:
      "List CSVs for ONE gym with exact column names + sample rows. " +
      "gym arg must be a slug from list_gyms (e.g. 'freeform', 'egym').",
    parameters: z.object({ gym: z.string() }),
    execute: async ({ gym }) => {
      counter.n++;
      if (!isValidGymSlug(gym)) {
        return {
          error: `Unknown gym: ${gym}`,
          hint: `Valid: ${listGyms().map(g => g.slug).join(", ")}. Call list_gyms first.`,
        };
      }
      const unavailable = gymUnavailableError(gym);
      if (unavailable) return unavailable;
      try {
        const store = registry.for(gym);
        const result = await buildListCsvsResult(store);
        snapshots[gym] = result.snapshot_date;
        return result;
      } catch (e) {
        return {
          error: `list_csvs failed for gym ${gym}: ${(e as Error).message}`,
        };
      }
    },
  });

  const queryCsvTool = tool({
    name: "query_csv",
    description:
      "Query one CSV of one gym. gym + csv args are required. " +
      "For filter ops: use 'val' for eq/neq/gt/gte/lt/lte/icontains. " +
      "Use 'val' AND 'val_to' for 'between'. Use 'val_list' for 'in'. " +
      "Use neither for 'isblank'/'notblank'.",
    parameters: queryArgs,
    execute: async (args: FlatQueryArgs) => {
      counter.n++;
      if (!isValidGymSlug(args.gym)) {
        return {
          error: `Unknown gym: ${args.gym}`,
          hint: `Valid: ${listGyms().map(g => g.slug).join(", ")}.`,
        };
      }
      const unavailable = gymUnavailableError(args.gym);
      if (unavailable) return unavailable;
      try {
        const store = registry.for(args.gym);
        const hint = CSV_HINTS[args.csv] ?? { date: [], number: [] };
        const text = await store.fetchCsv(args.csv);
        const { rows } = parseCsv(text, {
          dateColumns: hint.date,
          numberColumns: hint.number,
        });
        // Cache snapshot date opportunistically.
        if (!snapshots[args.gym]) {
          const pointer = await store.fetchLatest();
          snapshots[args.gym] = pointer.snapshot_date;
        }
        return applyQuery(rows, {
          filters: args.filters?.map(normalizeFilter),
          group_by: args.group_by ?? undefined,
          agg: args.agg ?? undefined,
          select: args.select ?? undefined,
          order_by: args.order_by ?? undefined,
          limit: args.limit ?? undefined,
        });
      } catch (e) {
        return {
          error: `query_csv failed for gym ${args.gym}, csv ${args.csv}: ${(e as Error).message}`,
        };
      }
    },
  });

  return [listGymsTool, listCsvsTool, queryCsvTool];
}

/**
 * Pre-warm snapshot dates so the system prompt can advertise per-gym
 * snapshot freshness. Distinguishes "no snapshot uploaded yet" from
 * "snapshot upload exists but we couldn't read it (transient error)"
 * so the system prompt can tell the model which gyms are safe to query
 * vs. which ones it should refuse with a clear error.
 */
type SnapshotLoad =
  | { status: "ok"; date: string }
  | { status: "missing" }            // pointer 404 — gym not yet seeded
  | { status: "error"; reason: string };  // anything else (auth, network, 5xx)

async function loadSnapshotDates(registry: BlobStoreRegistry): Promise<Record<string, SnapshotLoad>> {
  const out: Record<string, SnapshotLoad> = {};
  await Promise.all(
    listGyms().map(async g => {
      try {
        const pointer = await registry.for(g.slug).fetchLatest();
        out[g.slug] = { status: "ok", date: pointer.snapshot_date };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const looksMissing = /404|not\s*found|no such/i.test(message);
        out[g.slug] = looksMissing
          ? { status: "missing" }
          : { status: "error", reason: message.slice(0, 120) };
        // Surface non-404s in logs so an outage doesn't go unnoticed.
        if (!looksMissing) {
          console.warn(`[bot] snapshot load failed for gym=${g.slug}: ${message}`);
        }
      }
    }),
  );
  return out;
}

function snapshotsLine(snapshots: Record<string, SnapshotLoad>): string {
  const lines = listGyms().map(g => {
    const s = snapshots[g.slug];
    if (!s || s.status === "missing") return `  ${g.name}: (no snapshot yet — refuse data queries for this gym)`;
    if (s.status === "error") return `  ${g.name}: UNAVAILABLE (${s.reason}) — refuse data queries for this gym and tell user the snapshot is unreachable`;
    return `  ${g.name}: ${s.date}`;
  });
  return `SNAPSHOTS:\n${lines.join("\n")}`;
}

function snapshotDatesOnly(snapshots: Record<string, SnapshotLoad>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [slug, s] of Object.entries(snapshots)) {
    if (s.status === "ok") out[slug] = s.date;
  }
  return out;
}

export async function runLlm(input: RunLlmInput): Promise<RunLlmResult> {
  const { model, registry, question } = input;
  const maxTurns = input.maxIterations ?? 12;
  const todayIso = new Date().toISOString().slice(0, 10);

  // Pre-warm with structured load (status + reason), so the system prompt
  // can tell the model which gyms are unavailable today and to refuse
  // queries for them instead of inventing answers.
  const snapshotsStructured = await loadSnapshotDates(registry);
  // Tools-side dict holds only successful dates; tools mutate it as they
  // observe fresh snapshots, and the result envelope returns this dict.
  const snapshots = snapshotDatesOnly(snapshotsStructured);

  const counter = { n: 0 };
  const agent = new Agent({
    name: "TraqGym data analyst",
    instructions: systemPrompt(snapshotsLine(snapshotsStructured), todayIso),
    model,
    tools: buildTools(registry, counter, snapshots, snapshotsStructured),
  });

  const priorHistory = input.history ?? [];
  const userTurn: AgentInputItem = input.imageUrls && input.imageUrls.length > 0
    ? {
        role: "user",
        content: [
          { type: "input_text", text: question },
          ...input.imageUrls.map(url => ({
            type: "input_image" as const,
            image_url: url,
            detail: "auto" as const,
          })),
        ],
      }
    : user(question);
  const turnInput: AgentInputItem[] = [...priorHistory, userTurn];

  try {
    const result = await run(agent, turnInput, { maxTurns });
    const text = result.finalOutput?.toString().trim() ?? "";
    return {
      text,
      toolCalls: counter.n,
      snapshotDates: snapshots,
      history: result.history,
    };
  } catch (e) {
    if (e instanceof MaxTurnsExceededError) {
      return {
        text:
          "I ran out of analysis budget on this one. Try narrowing the question " +
          "(e.g. \"just the total for FFF\" instead of \"both gyms with caveats\").",
        toolCalls: counter.n,
        snapshotDates: snapshots,
        history: priorHistory,
      };
    }
    throw e;
  }
}
