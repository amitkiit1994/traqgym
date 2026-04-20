/**
 * Backfill User.createdAt for E-GYM Lokhandwala from FINAL_database_all.csv
 * "Created On" column.
 *
 * Why: pg_dump load did not preserve User.createdAt — every imported user
 * shows the import day, killing cohort/MoM/joined-this-month analytics.
 *
 * Match key: User.phone == cleanPhone(CSV "Mobile No"). On collision,
 * earliest CSV "Created On" wins (so a user who was first prospect 2018
 * doesn't get reset to a 2024 re-entry).
 *
 * Idempotent: skips if existing createdAt already matches CSV (within 1 day).
 * Default mode: --dry-run. Pass --apply to write.
 *
 * Usage:
 *   DATABASE_URL=...prod-egym... npx tsx scripts/backfill-user-createdat-egym.ts
 *   DATABASE_URL=...prod-egym... npx tsx scripts/backfill-user-createdat-egym.ts --apply
 */

import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import fs from "fs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CSV_PATH =
  "/Users/amitkumardas/freeformOS/freeformfitnessOS/egymlokhandwala-data-export/FINAL_database_all.csv";

function cleanPhone(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/[^0-9]/g, "").replace(/^91/, "").replace(/^0/, "");
}

function parseDate(raw: string): Date | null {
  if (!raw || raw === "N/a" || raw === "N/A") return null;
  const s = raw.trim();
  // dd Mon yyyy hh:mm:ss:SSS
  const longMatch = s.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2}):(\d{3})$/);
  if (longMatch) {
    const d = new Date(`${longMatch[2]} ${longMatch[1]}, ${longMatch[3]} ${longMatch[4]}:${longMatch[5]}:${longMatch[6]}`);
    if (!isNaN(d.getTime())) return d;
  }
  // dd-mm-yyyy hh:mm:ss
  const ddmm = s.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (ddmm) {
    const d = new Date(`${ddmm[3]}-${ddmm[2]}-${ddmm[1]}T${ddmm[4]}:${ddmm[5]}:${ddmm[6]}`);
    if (!isNaN(d.getTime())) return d;
  }
  // dd-mm-yyyy hh:mm AM/PM   (EGYM "Created On", e.g. "20-08-2019 12:00 AM")
  const ampm = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let hr = parseInt(ampm[4], 10);
    const ap = ampm[6].toUpperCase();
    if (ap === "PM" && hr < 12) hr += 12;
    if (ap === "AM" && hr === 12) hr = 0;
    const d = new Date(`${ampm[3]}-${ampm[2].padStart(2, "0")}-${ampm[1].padStart(2, "0")}T${String(hr).padStart(2, "0")}:${ampm[5]}:00`);
    if (!isNaN(d.getTime())) return d;
  }
  // dd-mm-yyyy (date only, EGYM "Prospect Date" fallback)
  const dOnly = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dOnly) {
    const d = new Date(`${dOnly[3]}-${dOnly[2].padStart(2, "0")}-${dOnly[1].padStart(2, "0")}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

async function main() {
  console.log(`[backfill-user-createdat-egym] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  const content = fs.readFileSync(CSV_PATH, "utf-8");
  const rows: Record<string, string>[] = parse(content, {
    columns: true, skip_empty_lines: true, trim: true, relax_column_count: true,
  });

  // Reduce duplicates: per phone, keep earliest "Created On".
  const earliest = new Map<string, Date>();
  for (const row of rows) {
    const phone = cleanPhone(row["Mobile No"]);
    if (!phone || phone.length < 7) continue;
    const d = parseDate(row["Created On"] || "") || parseDate(row["Prospect Date"] || "");
    if (!d) continue;
    const cur = earliest.get(phone);
    if (!cur || d < cur) earliest.set(phone, d);
  }

  // Bulk-load all users by phone — one query instead of N findFirst calls.
  // Sequential per-row updates over Railway disconnect mid-run; batch instead.
  console.log("  bulk-loading users...");
  const allUsers = await prisma.user.findMany({ select: { id: true, phone: true, createdAt: true } });
  const userByPhone = new Map<string, { id: number; createdAt: Date }>();
  for (const u of allUsers) {
    if (u.phone) userByPhone.set(u.phone, { id: u.id, createdAt: u.createdAt });
  }
  console.log(`  loaded ${userByPhone.size} users`);

  const total = earliest.size;
  let noUser = 0;
  let already = 0;
  let toUpdate = 0;
  let updated = 0;
  const pending: { id: number; createdAt: Date }[] = [];

  for (const [phone, csvDate] of earliest) {
    const u = userByPhone.get(phone);
    if (!u) { noUser++; continue; }
    const diffMs = Math.abs(u.createdAt.getTime() - csvDate.getTime());
    if (diffMs < 24 * 60 * 60 * 1000) { already++; continue; }
    toUpdate++;
    pending.push({ id: u.id, createdAt: csvDate });
    if (!APPLY && toUpdate <= 5) {
      console.log(`  user#${u.id} (${phone}): ${u.createdAt.toISOString().slice(0,10)} -> ${csvDate.toISOString().slice(0,10)}`);
    }
  }

  if (APPLY && pending.length) {
    const BATCH = 250;
    for (let i = 0; i < pending.length; i += BATCH) {
      const chunk = pending.slice(i, i + BATCH);
      await prisma.$transaction(
        chunk.map((p) => prisma.user.update({ where: { id: p.id }, data: { createdAt: p.createdAt } })),
      );
      updated += chunk.length;
      console.log(`  ...applied ${updated}/${pending.length}`);
    }
  }

  console.log("\nSummary:");
  console.log(`  unique phones in CSV : ${total}`);
  console.log(`  no user match        : ${noUser}`);
  console.log(`  already correct      : ${already}`);
  console.log(`  to update            : ${toUpdate}`);
  console.log(`  applied              : ${updated}`);
  if (!APPLY && toUpdate > 0) console.log(`\nRun with --apply to commit ${toUpdate} updates.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
