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

// Production binding for loadSnapshotsWith — single source of truth for
// the per-gym latest-pointer fetch. A direct copy of this with hard-coded
// `blobRegistry.for(slug)` used to exist; consolidating prevents drift
// when fixing things like the looksMissing pattern.
async function loadSnapshots(registry: BlobStoreRegistry): Promise<Record<string, SnapshotLoad>> {
  return loadSnapshotsWith(slug => registry.for(slug).fetchLatest());
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

// IST-local date as YYYY-MM-DD. The owner sees the digest in IST and the
// CSV Payment Date column is recorded in IST by gym staff; both ground
// truth and presentation are IST-anchored, so the verifier MUST be too.
// Using UTC would silently misalign by one day for manual digest runs
// after 18:30 UTC (= 00:00 IST next day).
export function istDateIso(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
function istYesterdayIso(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  ist.setUTCDate(ist.getUTCDate() - 1);
  return ist.toISOString().slice(0, 10);
}

// Full section-1 ground truth per gym: total, payment count, breakdown by
// canonical payment mode (Cash / GPay / Other), and 7-day-prior average.
// `.total` is what the verifier compares the LLM's headline against;
// the rest is what `overrideSection1FromGroundTruth` substitutes in when
// the LLM headline doesn't match. Null per-gym when payments CSV is
// unhealthy (parser misalignment) — redactor takes over for those, both
// verifier and override stay out.
//
// One fetch+parse per gym serves all three downstream consumers
// (verifier / redactor / override). An earlier split with a separate
// `computeYesterdayCollectionPerGym` doubled per-gym work and pushed
// the function past Vercel's 60s ceiling, returning a 504 with no
// brief sent.
export interface Section1Truth {
  total: number;
  count: number;
  byMode: Record<string, number>; // "Cash" | "GPay" | "Other" → ₹
  sevenDayAvg: number;            // mean of past-7-days totals (incl. yesterday)
}
async function computeYesterdaySection1PerGym(
  registry: BlobStoreRegistry,
  snapshots: Record<string, SnapshotLoad>,
): Promise<Record<string, Section1Truth | null>> {
  const yIso = istYesterdayIso();
  const sevenAgoIso = (() => {
    const d = new Date(`${yIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 6); // 7-day window inclusive of yesterday
    return d.toISOString().slice(0, 10);
  })();
  const out: Record<string, Section1Truth | null> = {};
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
        const meta = { columns, diagnostics: column_diagnostics, parse_errors };
        const yesterdaySum = applyQuery(rows, {
          filters: [{ col: "Payment Date", op: "between", val: [yIso, yIso] }],
          agg: { col: "Paid Amount", fn: "sum" },
        }, meta);
        if (yesterdaySum.warnings && yesterdaySum.warnings.length > 0) {
          out[slug] = null;
          return;
        }
        const yesterdayCount = applyQuery(rows, {
          filters: [{ col: "Payment Date", op: "between", val: [yIso, yIso] }],
          agg: { col: "Paid Amount", fn: "count" },
        }, meta);
        const byModeRaw = applyQuery(rows, {
          filters: [{ col: "Payment Date", op: "between", val: [yIso, yIso] }],
          group_by: ["Payment Mode"],
          agg: { col: "Paid Amount", fn: "sum" },
        }, meta);
        const sevenDay = applyQuery(rows, {
          filters: [{ col: "Payment Date", op: "between", val: [sevenAgoIso, yIso] }],
          agg: { col: "Paid Amount", fn: "sum" },
        }, meta);
        const total = typeof yesterdaySum.agg_result === "number" ? yesterdaySum.agg_result : 0;
        const count = typeof yesterdayCount.agg_result === "number" ? yesterdayCount.agg_result : 0;
        const sevenTotal = typeof sevenDay.agg_result === "number" ? sevenDay.agg_result : 0;
        const byMode: Record<string, number> = { Cash: 0, GPay: 0, Other: 0 };
        const groupSums = (byModeRaw.agg_result ?? {}) as Record<string, number>;
        for (const [rawMode, amt] of Object.entries(groupSums)) {
          // FB Payment Mode column is freeform; canonicalize so the same
          // bucket label appears no matter how staff typed it.
          const m = rawMode.trim().toLowerCase();
          if (m === "cash") byMode.Cash! += amt;
          else if (m === "gpay" || m === "google pay") byMode.GPay! += amt;
          else byMode.Other! += amt;
        }
        out[slug] = { total, count, byMode, sevenDayAvg: sevenTotal / 7 };
      } catch (e) {
        console.warn(`[digest] section1-truth failed for gym=${slug}: ${(e as Error).message}`);
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

// Extract a gym's body section from a brief shaped like:
//   === Gym A ===\n  body A\n  === Gym B ===\n  body B
// brief.split("===") returns [preamble, headerA, bodyA, headerB, bodyB, ...].
// Headers are at odd indices; the body for a header at index i is at i+1.
// The previous implementation used `.find()` on the split result, which
// returned the bare-name header segment (empty of rupee figures) instead
// of the body that follows — so every verification false-positived with
// "no rupee figures present in section". Exported for test coverage.
export function extractGymSection(brief: string, gymName: string): string | null {
  const parts = brief.split("===");
  for (let i = 1; i < parts.length - 1; i += 2) {
    if (parts[i]!.toUpperCase().includes(gymName.toUpperCase())) {
      return parts[i + 1] ?? null;
    }
  }
  return null;
}

// Defense-in-depth against fabricated YESTERDAY'S MONEY: even with the
// prompt's PAYMENTS-CSV ABSOLUTE GATE, gpt-* models have been observed to
// confidently write a headline number (with internally inconsistent
// Cash/GPay split) while correctly skipping later sections. When the
// verifier reports `null` for a gym — meaning the payments CSV is
// parser-flagged and there is no ground truth — we rewrite that gym's
// Headline + section 1 in-place so the operator sees an explicit skip
// instead of a hallucinated rupee figure.
//
// `computed[slug] === null` is the signal. Sections 2–5 are untouched
// because they read from different CSVs and may still be valid.
//
// Implementation: split the brief once on `===` so each gym's body sits
// at a known index, mutate the slot in place, then rejoin. Earlier
// `out.split(body).join(rewritten)` was collision-prone — two gyms with
// identical bodies would mutate both copies on the first pass and the
// second iteration would silently no-op.
//
// Exported for unit tests.
export function redactUnhealthySections(
  brief: string,
  computed: Record<string, number | null>,
): { brief: string; redacted: string[] } {
  const redacted: string[] = [];
  const parts = brief.split("===");
  // parts shape: [preamble, headerA, bodyA, headerB, bodyB, …]
  // Bodies sit at indices 2, 4, 6, … with their header at index-1.
  for (const [slug, expected] of Object.entries(computed)) {
    if (expected !== null) continue;
    const gym = getGym(slug);
    const upper = gym.name.toUpperCase();
    let bodyIdx = -1;
    for (let i = 1; i < parts.length - 1; i += 2) {
      if (parts[i]!.toUpperCase().includes(upper)) {
        bodyIdx = i + 1;
        break;
      }
    }
    if (bodyIdx === -1) continue;
    const body = parts[bodyIdx]!;
    const rewritten = rewriteGymBodyForUnhealthyPayments(body);
    if (rewritten !== body) {
      parts[bodyIdx] = rewritten;
      redacted.push(gym.name);
    }
  }
  return { brief: parts.join("==="), redacted };
}

// Hard-override the Headline + section 1 with CSV-computed ground truth
// when the LLM's headline number is more than 2% off from reality. The
// `redactUnhealthySections` sibling handles the "CSV is broken, can't
// trust anything" case; THIS function handles the (more dangerous, because
// invisible) "CSV is fine but LLM hallucinated anyway" case.
//
// Skip gyms in `alreadyRedacted` because their bodies were just rewritten
// to a skip marker — we'd be replacing the skip marker with computed
// numbers, which would confuse the operator about why we redacted in the
// first place.
//
// Returns the new brief plus per-gym `{ wasHeadlineRupee, computedTotal }`
// records for the entries that got overridden, so the caller can compose
// an [OVERRIDE] footer naming exactly what changed.
export function overrideSection1FromGroundTruth(
  brief: string,
  truth: Record<string, Section1Truth | null>,
  alreadyRedacted: ReadonlySet<string> = new Set(),
): { brief: string; overridden: Array<{ gymName: string; was: number | null; now: number }> } {
  const overridden: Array<{ gymName: string; was: number | null; now: number }> = [];
  const parts = brief.split("===");
  for (const [slug, gt] of Object.entries(truth)) {
    if (gt === null) continue;
    const gym = getGym(slug);
    if (alreadyRedacted.has(gym.name)) continue;
    const upper = gym.name.toUpperCase();
    let bodyIdx = -1;
    for (let i = 1; i < parts.length - 1; i += 2) {
      if (parts[i]!.toUpperCase().includes(upper)) {
        bodyIdx = i + 1;
        break;
      }
    }
    if (bodyIdx === -1) continue;
    const body = parts[bodyIdx]!;
    const headlineNum = extractHeadlineRupee(body);
    const tolerance = Math.max(gt.total * 0.02, 1);
    // Both Headline AND section 1 must already match ground truth for the
    // no-op shortcut. Headline-only is insufficient: 2026-05-21 brief
    // shipped `Headline: ₹12,000 in (skipped — payments CSV column
    // misaligned)` + `1. YESTERDAY'S MONEY: (skipped — ...)` — the LLM
    // wrote the real number in the headline but tagged section 1 skipped
    // (column-level diagnostic flagged even though yesterday-filtered rows
    // were clean). Headline matched, override no-oped, operator saw a
    // contradiction.
    const headlineOk = headlineNum !== null && Math.abs(headlineNum - gt.total) <= tolerance;
    const section1Rupee = body.match(/^[ \t]*1\.\s*YESTERDAY'S MONEY:\s*₹\s*([\d,]+)/m);
    const section1Num = section1Rupee ? Number(section1Rupee[1]!.replace(/,/g, "")) : null;
    const section1Ok = section1Num !== null && Number.isFinite(section1Num)
      && Math.abs(section1Num - gt.total) <= tolerance;
    if (headlineOk && section1Ok) continue;
    parts[bodyIdx] = rewriteSection1WithTruth(body, gt, headlineNum);
    overridden.push({ gymName: gym.name, was: headlineNum, now: gt.total });
  }
  return { brief: parts.join("==="), overridden };
}

function rewriteSection1WithTruth(
  body: string,
  gt: Section1Truth,
  wasHeadlineNum: number | null,
): string {
  const total = `₹${inrFormat(gt.total)}`;
  const breakdown = ["Cash", "GPay", "Other"]
    .filter(k => (gt.byMode[k] ?? 0) > 0)
    .map(k => `${k} ₹${inrFormat(gt.byMode[k]!)}`)
    .join(" / ") || "no payments";
  const wasNote = wasHeadlineNum !== null
    ? `LLM said ₹${inrFormat(wasHeadlineNum)}`
    : "LLM dropped headline number";
  const newSection1 =
    `1. YESTERDAY'S MONEY: ${total} • ${breakdown} • ${gt.count} payment${gt.count === 1 ? "" : "s"}\n` +
    `   • 7-day avg ₹${inrFormat(Math.round(gt.sevenDayAvg))}\n` +
    `   [OVERRIDE — ${wasNote}; CSV ground truth ₹${inrFormat(gt.total)}]\n`;

  let out = body;
  if (/^[ \t]*Headline:.*$/m.test(out)) {
    out = out.replace(
      /^([ \t]*)Headline:.*$/m,
      `$1Headline: ${total} in`,
    );
  } else {
    out = `\n  Headline: ${total} in${out}`;
  }
  const section1Re =
    /^([ \t]*)1\. YESTERDAY'S MONEY:[\s\S]*?(?=^[ \t]*(?:\d+\.|===)|\s*$(?![\r\n]))/m;
  if (section1Re.test(out)) {
    out = out.replace(section1Re, (_match, indent) => indent + newSection1);
  } else {
    out = out.replace(/(Headline:[^\n]*\n)/, `$1  ${newSection1}`);
  }
  return out;
}

function rewriteGymBodyForUnhealthyPayments(body: string): string {
  let out = body;
  if (/^[ \t]*Headline:.*$/m.test(out)) {
    out = out.replace(
      /^([ \t]*)Headline:.*$/m,
      "$1Headline: (payments data unreadable today)",
    );
  } else {
    out = `\n  Headline: (payments data unreadable today)${out}`;
  }
  // `\d+` (not `[2-9]`) so future sections like `10.` still terminate.
  const section1Re =
    /^([ \t]*)1\. YESTERDAY'S MONEY:[\s\S]*?(?=^[ \t]*(?:\d+\.|===)|\s*$(?![\r\n]))/m;
  if (section1Re.test(out)) {
    out = out.replace(
      section1Re,
      "$11. YESTERDAY'S MONEY: (skipped — payments CSV column misaligned in today's snapshot — operator action needed)\n",
    );
  } else {
    out = out.replace(
      /(Headline:[^\n]*\n)/,
      "$1  1. YESTERDAY'S MONEY: (skipped — payments CSV column misaligned in today's snapshot — operator action needed)\n",
    );
  }
  return out;
}

// Pull the first ₹ figure out of the gym body's `Headline:` line. The
// section-1 line is checked as a backup because the LLM has been observed
// to drop the Headline line entirely under load.
//
// The previous "any rupee figure in body matches expected" heuristic was
// too permissive: on a day where yesterday's only payment was ₹12,000 Cash,
// the brief's fabricated headline "₹52,300" with a real "Cash ₹12,000"
// sub-line passed verification because Cash matched expected. Anchoring to
// the headline + section-1 totals catches that exact pattern.
function extractHeadlineRupee(body: string): number | null {
  const headline = body.match(/^[ \t]*Headline:\s*₹\s*([\d,]+)/m);
  if (headline) {
    const n = Number(headline[1]!.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  const section1 = body.match(/^[ \t]*1\.\s*YESTERDAY'S MONEY:\s*₹\s*([\d,]+)/m);
  if (section1) {
    const n = Number(section1[1]!.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Verifier: returns appended warning text if the brief's HEADLINE numbers
// don't line up with the computed ground-truth per gym. Anchored to the
// Headline / "1. YESTERDAY'S MONEY" line specifically (not any rupee figure
// in the section) so a coincidentally-matching Cash sub-line can't mask a
// fabricated headline. Misses are reported as "verification failed for
// <gym>". Gyms with null `computed` (unhealthy CSV — no ground truth
// available) get a "VERIFICATION SKIPPED" line so the operator sees the
// safety net was disabled, not silently passing.
export function verifyBriefAgainstGroundTruth(
  brief: string,
  computed: Record<string, number | null>,
): string | null {
  const failures: string[] = [];
  const skipped: string[] = [];
  for (const [slug, expected] of Object.entries(computed)) {
    const gym = getGym(slug);
    if (expected === null) {
      skipped.push(`${gym.name}: payments CSV is parser-flagged or unreadable; headline number was not cross-checked`);
      continue;
    }
    const body = extractGymSection(brief, gym.name);
    if (body === null) {
      failures.push(`${gym.name}: section missing from brief`);
      continue;
    }
    const headlineNum = extractHeadlineRupee(body);
    if (headlineNum === null) {
      failures.push(`${gym.name}: no ₹ figure on Headline / "1. YESTERDAY'S MONEY" line (expected ₹${inrFormat(expected)})`);
      continue;
    }
    // 2% tolerance allows the LLM to round (e.g. 52,300 → 52,000) but
    // catches fabrications that drift outside rounding range.
    const tolerance = Math.max(expected * 0.02, 1);
    if (Math.abs(headlineNum - expected) > tolerance) {
      failures.push(
        `${gym.name}: brief headline says ₹${inrFormat(headlineNum)} but yesterday's collection was ₹${inrFormat(expected)}`,
      );
    }
  }
  if (failures.length === 0 && skipped.length === 0) return null;
  const parts: string[] = [];
  if (failures.length > 0) {
    parts.push(`[VERIFICATION WARNING — brief may be inaccurate]\n${failures.map(f => `- ${f}`).join("\n")}`);
  }
  if (skipped.length > 0) {
    parts.push(`[VERIFICATION SKIPPED — cannot confirm headline numbers]\n${skipped.map(s => `- ${s}`).join("\n")}`);
  }
  return `\n\n${parts.join("\n\n")}`;
}

async function buildBrief(blobRegistry: BlobStoreRegistry): Promise<{
  text: string; toolCalls: number; snapshots: Record<string, string>; model: string;
}> {
  const todayIso = istDateIso();
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
    // One fetch+parse per gym; verifier, redactor and override all read
    // from this. `expected[slug]` is just `section1Truth[slug]?.total`,
    // preserving the null=unhealthy contract every consumer was written
    // against.
    const section1Truth = await computeYesterdaySection1PerGym(
      blobRegistry,
      snapshotsStructured,
    );
    const expected: Record<string, number | null> = Object.fromEntries(
      Object.entries(section1Truth).map(([slug, t]) => [slug, t === null ? null : t.total]),
    );
    // Redaction first: if a gym's payments CSV is unhealthy, overwrite its
    // Headline + section 1 in-place so we never ship a fabricated number.
    // Verification runs after, on the redacted text, so its skipped-list
    // is consistent with what the operator actually sees.
    const { brief: redactedBrief, redacted } = redactUnhealthySections(
      briefRaw,
      expected,
    );
    briefText = redactedBrief;
    if (redacted.length > 0) {
      const note = `\n\n[AUTO-REDACTED — payments CSV unhealthy for: ${redacted.join(", ")}; Headline + section 1 replaced with skip marker]`;
      briefText += note;
      console.warn(`[digest] auto-redacted unhealthy gyms: ${redacted.join(", ")}`);
    }
    // Section-1 override: for gyms whose CSV is healthy but whose LLM
    // headline doesn't match ground truth within 2%, hard-replace
    // headline + section 1 with computed numbers. Catches the failure
    // mode the verifier alone couldn't — LLM fabricating GPay totals
    // and payment counts while Cash happens to match expected, so a
    // "any rupee figure matches" check silently passed.
    const { brief: overriddenBrief, overridden } = overrideSection1FromGroundTruth(
      briefText,
      section1Truth,
      new Set(redacted),
    );
    briefText = overriddenBrief;
    if (overridden.length > 0) {
      const lines = overridden.map(o =>
        `- ${o.gymName}: LLM said ${o.was !== null ? `₹${inrFormat(o.was)}` : "(no headline)"}, CSV ground truth ₹${inrFormat(o.now)}`,
      ).join("\n");
      const note = `\n\n[AUTO-OVERRIDE — LLM headline disagreed with CSV; replaced with computed numbers:\n${lines}]`;
      briefText += note;
      console.warn(`[digest] auto-override: ${overridden.map(o => `${o.gymName} ${o.was}->${o.now}`).join(", ")}`);
    }
    const warning = verifyBriefAgainstGroundTruth(briefText, expected);
    if (warning) {
      console.warn(`[digest] verification mismatch: ${warning.replace(/\n/g, " | ")}`);
      briefText = briefText + warning;
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
    let allowlistReadFailed = false;
    try {
      const al = await allowlistStore.read();
      for (const e of al.approved) recipients.add(e.chatId);
    } catch (e) {
      allowlistReadFailed = true;
      console.warn("digest: allowlist read failed; sending to env owners only", e);
    }

    // Lockout check BEFORE we run the LLM. Env owners + dynamic allowlist
    // both empty/unreachable means we'd generate a brief and send it to
    // nobody — and the previous code returned ok:true on zero recipients,
    // so the cron's jq -e '.ok' gate passed and the daily brief silently
    // disappeared. Burning the OpenAI call before discovering this is also
    // wasteful, so we short-circuit here.
    if (recipients.size === 0) {
      const cause = allowlistReadFailed
        ? "TELEGRAM_ALLOWED_CHAT_IDS is empty AND allowlist.json is unreachable"
        : "TELEGRAM_ALLOWED_CHAT_IDS is empty AND allowlist.json is empty";
      console.error(`[digest] LOCKOUT: ${cause} — refusing to generate brief with no recipients`);
      res.status(200).json({ ok: false, error: `no recipients (${cause})`, sent_to: 0, failed: 0 });
      return;
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
