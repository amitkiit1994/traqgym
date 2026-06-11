/**
 * Print the last N DigestRun metric rows for the shadow-window comparison
 * against the legacy CSV digest (Task #78 cutover check).
 *
 * The standalone telegram-bot's 09:00 IST digest output cannot be read
 * server-side, so the shadow cron stores OUR DB-computed numbers in
 * DigestRun.metrics. To validate before flipping digest_source to "db",
 * run this and diff each row by eye (or script) against the CSV digest
 * Telegram message of the same morning:
 *
 *   - yesterday total / payment count / mode split / 7-day avg
 *       vs "1. YESTERDAY'S MONEY"
 *   - expiring top-5 total + count   vs "2. EXPIRING SOON"
 *       (NOTE: DB digest uses a 14-day window, CSV uses 7 — DB count will
 *        be >= the CSV count; the named members should overlap)
 *   - dues top-5 total + count       vs "3. OUTSTANDING DUES"
 *       (NOTE: CSV filters balance > 10,000; DB uses balance > 0)
 *   - leads count                    vs "4. NEW LEADS"
 *
 * Usage: npx tsx scripts/compare-digest.ts [N]   (default N=3, max 30)
 *        add --text to also print the full stored digest text per row
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function inr(n: number | null): string {
  if (n === null) return "unavailable";
  return `Rs ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n))}`;
}

type Metrics = {
  date?: string;
  yesterday?: string;
  yesterdayTotal?: number | null;
  yesterdayCount?: number | null;
  byMode?: Record<string, number> | null;
  sevenDayAvg?: number | null;
  expiringTop5Total?: number | null;
  expiringCount?: number | null;
  duesTop5Total?: number | null;
  duesCount?: number | null;
  leadsCount?: number | null;
  openActionsCount?: number | null;
};

async function main() {
  const args = process.argv.slice(2);
  const showText = args.includes("--text");
  const nArg = args.find((a) => /^\d+$/.test(a));
  const n = Math.min(Math.max(parseInt(nArg ?? "3", 10) || 3, 1), 30);

  const runs = await prisma.digestRun.findMany({
    orderBy: { date: "desc" },
    take: n,
  });

  if (runs.length === 0) {
    console.log(
      "No DigestRun rows yet. The shadow cron (/api/cron/morning-digest at 08:55 IST) writes one per day."
    );
    return;
  }

  console.log(
    `Last ${runs.length} digest run(s), newest first — diff each against the CSV digest message of the same morning:\n`
  );

  for (const run of runs) {
    const m = (run.metrics ?? {}) as Metrics;
    const byMode = m.byMode
      ? Object.entries(m.byMode)
          .filter(([, v]) => v > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k} ${inr(v)}`)
          .join(" / ") || "(none)"
      : "unavailable";

    console.log(`=== ${run.date} (source=${run.source}, stored ${run.createdAt.toISOString()}) ===`);
    console.log(
      `  1. YESTERDAY'S MONEY (${m.yesterday ?? "?"}): ${inr(m.yesterdayTotal ?? null)}` +
        ` | ${m.yesterdayCount ?? "?"} payments | ${byMode}` +
        ` | 7-day avg ${inr(m.sevenDayAvg ?? null)}`
    );
    console.log(
      `  2. EXPIRING SOON (14d window): top-5 ${inr(m.expiringTop5Total ?? null)} | ${m.expiringCount ?? "?"} expiring  [CSV uses 7d window]`
    );
    console.log(
      `  3. OUTSTANDING DUES: top-5 ${inr(m.duesTop5Total ?? null)} | ${m.duesCount ?? "?"} members  [CSV filters > Rs 10,000]`
    );
    console.log(`  4. NEW LEADS: ${m.leadsCount ?? "?"}`);
    console.log(`  5. OPEN ACTIONS: ${m.openActionsCount ?? "?"}`);
    if (showText) {
      console.log("  --- stored text ---");
      console.log(
        run.text
          .split("\n")
          .map((l) => `  | ${l}`)
          .join("\n")
      );
    }
    console.log("");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
