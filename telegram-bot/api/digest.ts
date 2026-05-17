/**
 * Morning digest cron endpoint.
 *
 * Triggered daily by GitHub Actions at 01:00 UTC (06:30 IST), after the
 * CSV refresh cron has finished at 00:30 UTC. Generates a brief for each
 * allowlisted owner and sends via Telegram.
 *
 * Auth: shared secret in Authorization: Bearer <CRON_SECRET>.
 */

import { Agent, run, tool, user } from "@openai/agents";
import { z } from "zod";
import { loadConfig } from "../src/config.js";
import { createBlobStore } from "../src/data/blob-store.js";
import { parseCsv } from "../src/data/csv-parse.js";
import { buildListCsvsResult, CSV_HINTS } from "../src/tools/list-csvs.js";
import { applyQuery } from "../src/tools/query-csv.js";
import { sendTelegramMessage } from "../src/telegram/send-message.js";
import { digestSystemPrompt } from "../src/digest-prompt.js";

const config = loadConfig();
const blobStore = createBlobStore({ latestUrl: config.blobLatestUrl });
process.env.OPENAI_API_KEY = config.openaiApiKey;

const CRON_SECRET = process.env.CRON_SECRET ?? "";
const GYM_NAME = process.env.GYM_NAME ?? "Free Form Fitness";

// Same flat schema as the chat endpoint — keeps query_csv shape consistent.
const cell = z.string().nullable();
const flatFilter = z.object({
  col: z.string(),
  op: z.enum(["eq","neq","gt","gte","lt","lte","icontains","between","in","isblank","notblank"]),
  val: cell,
  val_to: cell,
  val_list: z.array(z.string()).nullable(),
});
const queryArgs = z.object({
  csv: z.string(),
  filters: z.array(flatFilter).nullable(),
  group_by: z.array(z.string()).nullable(),
  agg: z.object({ col: z.string(), fn: z.enum(["sum","count","avg","min","max"]) }).nullable(),
  select: z.array(z.string()).nullable(),
  order_by: z.object({ col: z.string(), dir: z.enum(["asc","desc"]) }).nullable(),
  limit: z.number().int().positive().max(200).nullable(),
});
type FlatFilter = z.infer<typeof flatFilter>;
type FlatQueryArgs = z.infer<typeof queryArgs>;

function normalize(f: FlatFilter): import("../src/tools/query-csv.js").Filter {
  switch (f.op) {
    case "between": return { col: f.col, op: "between", val: [f.val ?? "", f.val_to ?? ""] };
    case "in":      return { col: f.col, op: "in", val: f.val_list ?? [] };
    case "isblank":
    case "notblank": return { col: f.col, op: f.op };
    default:        return { col: f.col, op: f.op, val: f.val };
  }
}

async function buildBrief(): Promise<{ text: string; toolCalls: number; snapshotDate: string }> {
  const pointer = await blobStore.fetchLatest();
  const todayIso = new Date().toISOString().slice(0, 10);
  let toolCalls = 0;

  const listTool = tool({
    name: "list_csvs",
    description: "List CSVs with exact column names and sample rows.",
    parameters: z.object({}),
    execute: async () => {
      toolCalls++;
      return await buildListCsvsResult(blobStore);
    },
  });

  const queryTool = tool({
    name: "query_csv",
    description: "Query one CSV. val for most ops; val + val_to for between; val_list for in.",
    parameters: queryArgs,
    execute: async (args: FlatQueryArgs) => {
      toolCalls++;
      const hint = CSV_HINTS[args.csv] ?? { date: [], number: [] };
      const text = await blobStore.fetchCsv(args.csv);
      const { rows } = parseCsv(text, { dateColumns: hint.date, numberColumns: hint.number });
      return applyQuery(rows, {
        filters: args.filters?.map(normalize),
        group_by: args.group_by ?? undefined,
        agg: args.agg ?? undefined,
        select: args.select ?? undefined,
        order_by: args.order_by ?? undefined,
        limit: args.limit ?? undefined,
      });
    },
  });

  const agent = new Agent({
    name: "TraqGym morning digest",
    instructions: digestSystemPrompt(pointer.snapshot_date, todayIso, GYM_NAME),
    model: config.openaiModel,
    tools: [listTool, queryTool],
  });

  const result = await run(agent, [user("Generate today's owner brief.")], { maxTurns: 25 });
  return {
    text: result.finalOutput?.toString().trim() ?? "(no brief generated)",
    toolCalls,
    snapshotDate: pointer.snapshot_date,
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).end();
    return;
  }

  // Shared-secret check — GH Action POSTs with Authorization: Bearer <CRON_SECRET>.
  const auth = req.headers["authorization"];
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    res.status(401).end();
    return;
  }

  try {
    const { text, toolCalls, snapshotDate } = await buildBrief();
    const sends: Promise<void>[] = [];
    for (const chatId of config.allowedChatIds) {
      sends.push(
        sendTelegramMessage({
          token: config.telegramBotToken,
          chatId,
          text,
        }),
      );
    }
    await Promise.allSettled(sends);
    console.log(JSON.stringify({
      kind: "digest",
      ts: new Date().toISOString(),
      recipients: [...config.allowedChatIds],
      n_tool_calls: toolCalls,
      model: config.openaiModel,
      latency_ms: Date.now() - started,
      snapshot_date: snapshotDate,
      preview: text.slice(0, 200),
    }));
    res.status(200).json({ ok: true, sent_to: config.allowedChatIds.size, snapshot_date: snapshotDate });
  } catch (e) {
    console.error("digest error", e);
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
