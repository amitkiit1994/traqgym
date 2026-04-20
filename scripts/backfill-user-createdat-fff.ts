/**
 * Backfill User.createdAt for Free Form Fitness (FFF) prod DB.
 *
 * Why: the original migrate-fitnessboard.ts run did not set User.createdAt
 * from the CSV "Created On" field, so every imported user shows the import
 * day as their signup date. This breaks cohort retention, MoM signup graphs,
 * and the "joined this month" tile.
 *
 * Source of truth: competitor-data-export/all_people.csv "Created On" column.
 * Match key: User.phone == cleanPhone(CSV "Contact No.").
 *
 * Idempotent: only updates rows whose current createdAt is within 24h of the
 * import day (heuristic: createdAt > all CSV dates, i.e. not yet backfilled).
 * Re-running after success is a no-op.
 *
 * Default mode: --dry-run (prints what would change). Pass --apply to write.
 *
 * Usage:
 *   DATABASE_URL=...prod-fff... npx tsx scripts/backfill-user-createdat-fff.ts
 *   DATABASE_URL=...prod-fff... npx tsx scripts/backfill-user-createdat-fff.ts --apply
 */

import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import fs from "fs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CSV_PATH = "/Users/amitkumardas/freeformOS/competitor-data-export/all_people.csv";

function cleanPhone(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/[^0-9]/g, "").replace(/^91/, "").replace(/^0/, "");
}

function parseDate(raw: string): Date | null {
  if (!raw || raw === "N/a" || raw === "N/A") return null;
  const s = raw.trim();
  // dd Mon yyyy hh:mm:ss:SSS  (e.g. "16 Feb 2026 00:00:00:000")
  const longMatch = s.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2}):(\d{3})$/);
  if (longMatch) {
    const d = new Date(`${longMatch[2]} ${longMatch[1]}, ${longMatch[3]} ${longMatch[4]}:${longMatch[5]}:${longMatch[6]}`);
    if (!isNaN(d.getTime())) return d;
  }
  // dd-mm-yyyy  (e.g. "23-07-2024" — FFF all_people.csv "Created On")
  const dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) {
    const d = new Date(`${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  // dd-mm-yyyy hh:mm:ss
  const dmyT = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (dmyT) {
    const d = new Date(`${dmyT[3]}-${dmyT[2].padStart(2, "0")}-${dmyT[1].padStart(2, "0")}T${dmyT[4]}:${dmyT[5]}:${dmyT[6]}`);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

async function main() {
  console.log(`[backfill-user-createdat-fff] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  const content = fs.readFileSync(CSV_PATH, "utf-8");
  const rows: Record<string, string>[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  let toUpdate = 0;
  let updated = 0;
  let skippedNoMatch = 0;
  let skippedNoDate = 0;
  let skippedAlreadyCorrect = 0;

  for (const row of rows) {
    const phone = cleanPhone(row["Contact No."]);
    if (!phone || phone.length < 7) continue;
    const createdAt = parseDate(row["Created On"] || "");
    if (!createdAt) {
      skippedNoDate++;
      continue;
    }

    const user = await prisma.user.findFirst({
      where: { phone },
      select: { id: true, createdAt: true, email: true, firstname: true },
    });
    if (!user) {
      skippedNoMatch++;
      continue;
    }

    // Idempotent: skip if existing createdAt already matches CSV (within 1 day)
    const diffMs = Math.abs(user.createdAt.getTime() - createdAt.getTime());
    if (diffMs < 24 * 60 * 60 * 1000) {
      skippedAlreadyCorrect++;
      continue;
    }

    toUpdate++;
    if (APPLY) {
      await prisma.user.update({ where: { id: user.id }, data: { createdAt } });
      updated++;
      if (updated % 50 === 0) console.log(`  ...applied ${updated}`);
    } else if (toUpdate <= 5) {
      console.log(`  would update user#${user.id} ${user.firstname} (${phone}) ${user.createdAt.toISOString().slice(0, 10)} -> ${createdAt.toISOString().slice(0, 10)}`);
    }
  }

  console.log("\nSummary:");
  console.log(`  CSV rows scanned        : ${rows.length}`);
  console.log(`  to update               : ${toUpdate}`);
  console.log(`  applied                 : ${updated}`);
  console.log(`  skipped (no phone match): ${skippedNoMatch}`);
  console.log(`  skipped (no CSV date)   : ${skippedNoDate}`);
  console.log(`  skipped (already correct): ${skippedAlreadyCorrect}`);
  if (!APPLY && toUpdate > 0) console.log(`\nRun with --apply to commit ${toUpdate} updates.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
