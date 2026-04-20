/**
 * Backfill MemberTicket.balanceDue from FINAL_balance.csv (EGYM).
 *
 * Why: pg_dump load did not populate `balanceDue` on tickets, so the
 * Balance Due tile and report show ~₹1.34L less than reality. The CSV has
 * one row per member with their currently outstanding balance.
 *
 * Source: FINAL_balance.csv. Match key: phone (Contact No) → User → most
 * recent active MemberTicket. If no active ticket, fall back to most recent
 * ticket overall.
 *
 * Idempotent: skips rows whose ticket already has the same balance.
 * Default mode: --dry-run. Pass --apply to write.
 *
 * Usage:
 *   DATABASE_URL=...prod-egym... npx tsx scripts/backfill-balance-due-egym.ts
 *   DATABASE_URL=...prod-egym... npx tsx scripts/backfill-balance-due-egym.ts --apply
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { parse } from "csv-parse/sync";
import fs from "fs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CSV_PATH =
  "/Users/amitkumardas/freeformOS/freeformfitnessOS/egymlokhandwala-data-export/FINAL_balance.csv";

function cleanPhone(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/[^0-9]/g, "").replace(/^91/, "").replace(/^0/, "");
}

async function main() {
  console.log(`[backfill-balance-due-egym] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  const content = fs.readFileSync(CSV_PATH, "utf-8");
  const rows: Record<string, string>[] = parse(content, {
    columns: true, skip_empty_lines: true, trim: true, relax_column_count: true,
  });

  let total = 0;
  let noPhone = 0;
  let noUser = 0;
  let noTicket = 0;
  let already = 0;
  let toUpdate = 0;
  let updated = 0;
  let totalDelta = new Prisma.Decimal(0);

  for (const row of rows) {
    total++;
    const phone = cleanPhone(row["Contact No"]);
    if (!phone || phone.length < 7) { noPhone++; continue; }

    const balanceRaw = (row["Balance Amt."] || "").replace(/[, ]/g, "");
    const balance = Number(balanceRaw);
    if (!isFinite(balance) || balance <= 0) continue;

    const user = await prisma.user.findFirst({ where: { phone }, select: { id: true } });
    if (!user) { noUser++; continue; }

    // Prefer an ACTIVE ticket; only fall back to most-recent if no active row exists.
    // Lexical sort on `status` is fragile across schemas, so do it with two queries.
    let ticket = await prisma.memberTicket.findFirst({
      where: { userId: user.id, status: "active" },
      orderBy: { buyDate: "desc" },
      select: { id: true, balanceDue: true },
    });
    if (!ticket) {
      ticket = await prisma.memberTicket.findFirst({
        where: { userId: user.id },
        orderBy: { buyDate: "desc" },
        select: { id: true, balanceDue: true },
      });
    }
    if (!ticket) { noTicket++; continue; }

    const current = (ticket.balanceDue ?? new Prisma.Decimal(0)).toNumber();
    if (current === balance) { already++; continue; }

    toUpdate++;
    totalDelta = totalDelta.plus(new Prisma.Decimal(balance - current));
    if (APPLY) {
      await prisma.memberTicket.update({ where: { id: ticket.id }, data: { balanceDue: balance } });
      updated++;
      if (updated % 100 === 0) console.log(`  ...applied ${updated}`);
    } else if (toUpdate <= 8) {
      console.log(`  ticket#${ticket.id} (user#${user.id}, ${phone}): ${current} -> ${balance}`);
    }
  }

  console.log("\nSummary:");
  console.log(`  CSV rows scanned    : ${total}`);
  console.log(`  no phone            : ${noPhone}`);
  console.log(`  no user match       : ${noUser}`);
  console.log(`  no ticket           : ${noTicket}`);
  console.log(`  already correct     : ${already}`);
  console.log(`  to update           : ${toUpdate}`);
  console.log(`  applied             : ${updated}`);
  console.log(`  net balance delta   : ₹${totalDelta.toFixed(2)}`);
  if (!APPLY && toUpdate > 0) console.log(`\nRun with --apply to commit ${toUpdate} updates.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
