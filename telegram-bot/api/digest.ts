/**
 * Morning digest cron endpoint (multi-gym).
 *
 * Daily 06:30 IST via GitHub Actions (after CSV refresh at 06:00 IST).
 * Generates ONE combined brief covering every gym in the registry,
 * sends to every owner (env owners ∪ /approve-d users).
 *
 * Auth: shared secret in Authorization: Bearer <CRON_SECRET>.
 */

import { Agent, run, tool, user } from "@openai/agents";
import { z } from "zod";
import { loadConfig, type Config } from "../src/config.js";
import { BlobStoreRegistry } from "../src/data/blob-store.js";
import { createAllowlistStore } from "../src/data/allowlist-store.js";
import { parseCsv } from "../src/data/csv-parse.js";
import { buildListCsvsResult, CSV_HINTS } from "../src/tools/list-csvs.js";
import { applyQuery } from "../src/tools/query-csv.js";
import { sendTelegramMessage } from "../src/telegram/send-message.js";
import { digestSystemPrompt } from "../src/digest-prompt.js";
import { listGyms, isValidGymSlug, getGym } from "../src/gyms.js";

// Lazy config + singletons. Module-top-level throw would let Vercel return
// 500 to the cron caller, masking which env var is missing.
interface DigestDeps {
  config: Config;
  blobRegistry: BlobStoreRegistry;
  allowlistStore: ReturnType<typeof createAllowlistStore>;
}
let cachedDeps: DigestDeps | null = null;
let cachedConfigError: Error | null = null;

function getDeps(): DigestDeps {
  if (cachedConfigError) throw cachedConfigError;
  if (cachedDeps) return cachedDeps;
  try {
    const config = loadConfig();
    const deps: DigestDeps = {
      config,
      blobRegistry: new BlobStoreRegistry(config.blobBaseUrl),
      allowlistStore: createAllowlistStore({
        url: `${config.blobBaseUrl}/allowlist.json`,
        token: config.blobReadWriteToken,
      }),
    };
    process.env.OPENAI_API_KEY = config.openaiApiKey;
    cachedDeps = deps;
    return deps;
  } catch (e) {
    cachedConfigError = e as Error;
    throw e;
  }
}

const CRON_SECRET = process.env.CRON_SECRET ?? "";
// gpt-5 is too slow for the 60s function cap when computing per-gym briefs;
// 4o-mini handles 6 sections × N gyms in ~25s reliably.
const DIGEST_MODEL = process.env.DIGEST_MODEL ?? "gpt-4o-mini";

const flatFilter = z.object({
  col: z.string(),
  op: z.enum(["eq","neq","gt","gte","lt","lte","icontains","between","in","isblank","notblank"]),
  val: z.string().nullable(),
  val_to: z.string().nullable(),
  val_list: z.array(z.string()).nullable(),
});
const queryArgs = z.object({
  gym: z.string(),
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

export type SnapshotLoad =
  | { status: "ok"; date: string }
  | { status: "missing" }
  | { status: "error"; reason: string };

// Exported so the unit test in tests/digest-snapshots.test.ts can drive
// it with a mock BlobStoreRegistry. The default export is the bound
// production version that hits the real registry.
export async function loadSnapshotsWith(
  fetchLatestFor: (slug: string) => Promise<{ snapshot_date: string }>,
  gyms: ReadonlyArray<{ slug: string }> = listGyms(),
): Promise<Record<string, SnapshotLoad>> {
  const out: Record<string, SnapshotLoad> = {};
  await Promise.all(
    gyms.map(async g => {
      try {
        const p = await fetchLatestFor(g.slug);
        out[g.slug] = { status: "ok", date: p.snapshot_date };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const looksMissing = /404|not\s*found|no such/i.test(message);
        out[g.slug] = looksMissing
          ? { status: "missing" }
          : { status: "error", reason: message.slice(0, 120) };
        if (!looksMissing) {
          console.warn(`[digest] snapshot load failed for gym=${g.slug}: ${message}`);
        }
      }
    }),
  );
  return out;
}

async function loadSnapshots(registry: BlobStoreRegistry): Promise<Record<string, SnapshotLoad>> {
  const out: Record<string, SnapshotLoad> = {};
  await Promise.all(
    listGyms().map(async g => {
      try {
        const p = await registry.for(g.slug).fetchLatest();
        out[g.slug] = { status: "ok", date: p.snapshot_date };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const looksMissing = /404|not\s*found|no such/i.test(message);
        out[g.slug] = looksMissing
          ? { status: "missing" }
          : { status: "error", reason: message.slice(0, 120) };
        if (!looksMissing) {
          console.warn(`[digest] snapshot load failed for gym=${g.slug}: ${message}`);
        }
      }
    }),
  );
  return out;
}

export function snapshotsLine(snapshots: Record<string, SnapshotLoad>): string {
  const lines = listGyms().map(g => {
    const s = snapshots[g.slug];
    if (!s || s.status === "missing") return `  ${g.name}: (no snapshot yet)`;
    if (s.status === "error") return `  ${g.name}: UNAVAILABLE (${s.reason})`;
    return `  ${g.name}: snapshot ${s.date}`;
  });
  return `SNAPSHOTS:\n${lines.join("\n")}`;
}

export function snapshotDatesOnly(snapshots: Record<string, SnapshotLoad>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [slug, s] of Object.entries(snapshots)) {
    if (s.status === "ok") out[slug] = s.date;
  }
  return out;
}

export function anySnapshotLoaded(snapshots: Record<string, SnapshotLoad>): boolean {
  return Object.values(snapshots).some(s => s.status === "ok");
}

// Compute yesterday's collection per gym from the raw CSV (no LLM in the
// loop). Used by post-LLM verification to confirm the brief's headlines
// don't silently lie about real numbers. Returns null per-gym when the
// payments CSV is unhealthy (parser misalignment).
async function computeYesterdayCollectionPerGym(
  registry: BlobStoreRegistry,
  snapshots: Record<string, SnapshotLoad>,
  todayIso: string,
): Promise<Record<string, number | null>> {
  const yesterday = new Date(todayIso + "T00:00:00Z");
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yIso = yesterday.toISOString().slice(0, 10);
  const out: Record<string, number | null> = {};
  await Promise.all(
    Object.entries(snapshots).map(async ([slug, s]) => {
      if (s.status !== "ok") return;
      try {
        const store = registry.for(slug);
        const text = await store.fetchCsv("payments");
        const hint = CSV_HINTS.payments ?? { date: [], number: [] };
        const { rows, columns, column_diagnostics, parse_errors } = parseCsv(text, {
          dateColumns: hint.date,
          numberColumns: hint.number,
        });
        const res = applyQuery(
          rows,
          {
            filters: [{ col: "Payment Date", op: "between", val: [yIso, yIso] }],
            agg: { col: "Paid Amount", fn: "sum" },
          },
          { columns, diagnostics: column_diagnostics, parse_errors },
        );
        if (res.warnings && res.warnings.length > 0) {
          // Misaligned column → can't trust the number, treat as unknown.
          out[slug] = null;
          return;
        }
        out[slug] = typeof res.agg_result === "number" ? res.agg_result : null;
      } catch (e) {
        console.warn(`[digest] yesterday-verify failed for gym=${slug}: ${(e as Error).message}`);
        out[slug] = null;
      }
    }),
  );
  return out;
}

// Format INR with Indian-style grouping commas (e.g. 305700 -> "3,05,700").
function inrFormat(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

// Verifier: returns appended warning text if the brief's headline numbers
// don't line up with the computed ground-truth per gym. Heuristic — looks
// for the gym's name + a number that's within 1% of the computed value
// (allows for rounding in the LLM's output). Misses are reported as
// "verification failed for <gym>".
function verifyBriefAgainstGroundTruth(
  brief: string,
  computed: Record<string, number | null>,
): string | null {
  const failures: string[] = [];
  for (const [slug, expected] of Object.entries(computed)) {
    if (expected === null) continue; // Snapshot unhealthy; not verifying.
    const gym = getGym(slug);
    // Find the gym's section in the brief (=== Gym Name ===).
    const sectionMatch = brief.split("===").find(s => s.toUpperCase().includes(gym.name.toUpperCase()));
    if (!sectionMatch) {
      failures.push(`${gym.name}: section missing from brief`);
      continue;
    }
    // Pull all rupee-formatted numbers from the section.
    const nums: number[] = [];
    for (const m of sectionMatch.matchAll(/₹\s*([\d,]+)/g)) {
      const n = Number(m[1]!.replace(/,/g, ""));
      if (Number.isFinite(n)) nums.push(n);
    }
    if (nums.length === 0) {
      failures.push(`${gym.name}: no rupee figures present in section (expected ₹${inrFormat(expected)})`);
      continue;
    }
    const tolerance = Math.max(expected * 0.02, 1);
    const matched = nums.some(n => Math.abs(n - expected) <= tolerance);
    if (!matched) {
      failures.push(
        `${gym.name}: brief shows ${nums.map(n => `₹${inrFormat(n)}`).join(", ")} but yesterday's collection was ₹${inrFormat(expected)}`,
      );
    }
  }
  if (failures.length === 0) return null;
  return `\n\n[VERIFICATION WARNING — brief may be inaccurate]\n${failures.map(f => `- ${f}`).join("\n")}`;
}

async function buildBrief(blobRegistry: BlobStoreRegistry): Promise<{
  text: string; toolCalls: number; snapshots: Record<string, string>; model: string;
}> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const snapshotsStructured = await loadSnapshots(blobRegistry);
  if (!anySnapshotLoaded(snapshotsStructured)) {
    // Every gym's pointer failed — refuse rather than send a useless brief.
    // The cron's non-200 alert will surface the outage.
    const reasons = Object.entries(snapshotsStructured)
      .map(([slug, s]) => `${slug}: ${s.status === "error" ? s.reason : s.status}`)
      .join(" | ");
    throw new Error(`No snapshots loaded for any gym: ${reasons}`);
  }
  const snapshots = snapshotDatesOnly(snapshotsStructured);
  let toolCalls = 0;

  const listGymsTool = tool({
    name: "list_gyms",
    description: "List all gyms in this brief. Returns slug + display name.",
    parameters: z.object({}),
    execute: async () => {
      toolCalls++;
      return { gyms: listGyms().map(g => ({ slug: g.slug, name: g.name })) };
    },
  });

  const listTool = tool({
    name: "list_csvs",
    description: "List CSVs for ONE gym with exact column names. gym arg is required.",
    parameters: z.object({ gym: z.string() }),
    execute: async ({ gym }) => {
      toolCalls++;
      if (!isValidGymSlug(gym)) {
        return {
          error: `Unknown gym: ${gym}`,
          hint: `Valid: ${listGyms().map(g => g.slug).join(", ")}`,
        };
      }
      try {
        return await buildListCsvsResult(blobRegistry.for(gym));
      } catch (e) {
        return { error: `list_csvs failed for ${gym}: ${(e as Error).message}` };
      }
    },
  });

  const queryTool = tool({
    name: "query_csv",
    description: "Query one CSV of one gym. gym + csv required.",
    parameters: queryArgs,
    execute: async (args: FlatQueryArgs) => {
      toolCalls++;
      if (!isValidGymSlug(args.gym)) {
        return {
          error: `Unknown gym: ${args.gym}`,
          hint: `Valid: ${listGyms().map(g => g.slug).join(", ")}`,
        };
      }
      try {
        const store = blobRegistry.for(args.gym);
        const hint = CSV_HINTS[args.csv] ?? { date: [], number: [] };
        const text = await store.fetchCsv(args.csv);
        const { columns, rows, parse_errors, column_diagnostics } = parseCsv(text, {
          dateColumns: hint.date, numberColumns: hint.number,
        });
        return applyQuery(
          rows,
          {
            filters: args.filters?.map(normalize),
            group_by: args.group_by ?? undefined,
            agg: args.agg ?? undefined,
            select: args.select ?? undefined,
            order_by: args.order_by ?? undefined,
            limit: args.limit ?? undefined,
          },
          { columns, diagnostics: column_diagnostics, parse_errors },
        );
      } catch (e) {
        return { error: `query_csv failed for ${args.gym}/${args.csv}: ${(e as Error).message}` };
      }
    },
  });

  const agent = new Agent({
    name: "TraqGym morning digest",
    instructions: digestSystemPrompt(snapshotsLine(snapshotsStructured), todayIso),
    model: DIGEST_MODEL,
    tools: [listGymsTool, listTool, queryTool],
  });

  const result = await run(
    agent,
    [user("Generate today's owner brief covering every gym.")],
    { maxTurns: 30 },
  );
  const briefRaw = result.finalOutput?.toString().trim() ?? "(no brief generated)";

  // Post-LLM verification: independently compute yesterday's collection
  // per gym from the raw CSV and assert the brief's text contains a number
  // within 2% of that. If a gym section is missing OR carries the wrong
  // number, append a clearly-marked warning so the owner sees we suspect
  // the brief. Verification skips gyms whose payments CSV is unhealthy
  // (parser misalignment) — there's no ground truth to check against.
  let briefText = briefRaw;
  try {
    const expected = await computeYesterdayCollectionPerGym(
      blobRegistry,
      snapshotsStructured,
      todayIso,
    );
    const warning = verifyBriefAgainstGroundTruth(briefRaw, expected);
    if (warning) {
      console.warn(`[digest] verification mismatch: ${warning.replace(/\n/g, " | ")}`);
      briefText = briefRaw + warning;
    }
  } catch (e) {
    console.warn(`[digest] verification step itself failed: ${(e as Error).message}`);
  }

  return {
    text: briefText,
    toolCalls,
    snapshots,
    model: DIGEST_MODEL,
  };
}

export default async function handler(req: any, res: any) {
  const started = Date.now();
  if (req.method !== "POST" && req.method !== "GET") {
    res.status(405).end();
    return;
  }

  const auth = req.headers["authorization"];
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    res.status(401).end();
    return;
  }

  let deps: ReturnType<typeof getDeps>;
  try {
    deps = getDeps();
  } catch (e) {
    console.error("[digest] config init failed", e);
    res.status(500).json({ ok: false, error: (e as Error).message });
    return;
  }
  const { config, blobRegistry, allowlistStore } = deps;

  try {
    const recipients = new Set<number>(config.allowedChatIds);
    try {
      const al = await allowlistStore.read();
      for (const e of al.approved) recipients.add(e.chatId);
    } catch (e) {
      console.warn("digest: allowlist read failed; sending to env owners only", e);
    }

    const { text, toolCalls, snapshots, model: usedModel } = await buildBrief(blobRegistry);

    const sends: Promise<void>[] = [];
    for (const chatId of recipients) {
      sends.push(
        sendTelegramMessage({
          token: config.telegramBotToken,
          chatId,
          text,
        }),
      );
    }
    const recipientList = [...recipients];
    const results = await Promise.allSettled(sends);
    const failed = results.filter(r => r.status === "rejected").length;
    // Log each rejected send with chatId + reason so a consistently-failing
    // recipient (blocked bot, deactivated account) is visible in logs.
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.warn(`[digest] send failed for chat=${recipientList[i]}: ${reason}`);
      }
    });

    console.log(JSON.stringify({
      kind: "digest",
      ts: new Date().toISOString(),
      recipients: recipientList,
      n_sent: recipients.size - failed,
      n_failed: failed,
      n_tool_calls: toolCalls,
      model: usedModel,
      latency_ms: Date.now() - started,
      snapshots,
      preview: text.slice(0, 200),
    }));
    // ok must reflect actual delivery — if every send rejected (Telegram
    // outage, every owner blocked the bot), this is a real failure that
    // the morning-digest cron's `jq -e '.ok'` check must catch. Returning
    // ok:true on 0/N delivery would silently lose the daily brief.
    const allFailed = failed > 0 && failed >= recipients.size;
    res.status(200).json({
      ok: !allFailed,
      sent_to: recipients.size - failed,
      failed,
      snapshots,
    });
  } catch (e) {
    console.error("digest error", e);
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
