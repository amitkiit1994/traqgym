/**
 * Backfill the 23 zero-amount Payment rows that the original FFF importer
 * dropped (legacy guard `if (amount <= 0) continue;`).
 *
 * These are comp passes / waived joining fees the owner currently can't see
 * in any report. We re-create them as Payment rows with paymentMode =
 * "complimentary", amount = 0, attached to the matching MemberTicket.
 *
 * Source of truth: competitor-data-export/payments.csv where Paid Amount = 0.
 * Match key: dedupe by `FB-{InvoiceNo}` invoice number (same convention as
 * the original importer at scripts/migrate-fitnessboard.ts:512).
 *
 * Idempotent: skips if Invoice with `FB-{invoiceNo}` already exists.
 *
 * Default mode: --dry-run. Pass --apply to write.
 *
 * Usage:
 *   DATABASE_URL=...prod-fff... npx tsx scripts/backfill-zero-amount-payments-fff.ts
 *   DATABASE_URL=...prod-fff... npx tsx scripts/backfill-zero-amount-payments-fff.ts --apply
 */

import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import fs from "fs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CSV_PATH = "/Users/amitkumardas/freeformOS/competitor-data-export/payments.csv";

function cleanPhone(raw: string | undefined): string {
  if (!raw) return "";
  return raw.replace(/[^0-9]/g, "").replace(/^91/, "").replace(/^0/, "");
}

function parseDate(raw: string): Date | null {
  if (!raw || raw === "N/a" || raw === "N/A") return null;
  const s = raw.trim();
  const longMatch = s.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2}):(\d{3})$/);
  if (longMatch) {
    const d = new Date(`${longMatch[2]} ${longMatch[1]}, ${longMatch[3]} ${longMatch[4]}:${longMatch[5]}:${longMatch[6]}`);
    if (!isNaN(d.getTime())) return d;
  }
  const ddmm = s.match(/^(\d{2})-(\d{2})-(\d{4})\s+\d{2}:\d{2}:\d{2}$/);
  if (ddmm) {
    const d = new Date(`${ddmm[3]}-${ddmm[2]}-${ddmm[1]}T00:00:00`);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

async function main() {
  console.log(`[backfill-zero-amount-payments-fff] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  const content = fs.readFileSync(CSV_PATH, "utf-8");
  const rows: Record<string, string>[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  const fallbackWorker = await prisma.worker.findFirst({ orderBy: { id: "asc" } });
  if (!fallbackWorker) throw new Error("No Worker rows found — cannot set collectedById");
  const fallbackLocation = await prisma.location.findFirst({ orderBy: { id: "asc" } });
  if (!fallbackLocation) throw new Error("No Location rows found");

  let zeroRows = 0;
  let skippedNoUser = 0;
  let skippedNoTicket = 0;
  let skippedDup = 0;
  let toCreate = 0;
  let created = 0;

  for (const row of rows) {
    const amountStr = (row["Paid Amount"] || "").trim();
    const amount = Number(amountStr);
    if (!isFinite(amount) || amount !== 0) continue;
    zeroRows++;

    const invoiceNo = row["InvoiceNo"]?.trim();
    if (!invoiceNo) continue;
    const fbInvoice = `FB-${invoiceNo}`;

    const dup = await prisma.invoice.findFirst({ where: { invoiceNumber: fbInvoice } });
    if (dup) { skippedDup++; continue; }

    const phone = cleanPhone(row["Contact No"]);
    const user = phone
      ? await prisma.user.findFirst({ where: { phone }, select: { id: true, firstname: true } })
      : null;
    if (!user) { skippedNoUser++; continue; }

    const ticket = await prisma.memberTicket.findFirst({
      where: { userId: user.id },
      orderBy: { buyDate: "desc" },
      select: { id: true, locationId: true },
    });
    if (!ticket) { skippedNoTicket++; continue; }

    const paymentDate = parseDate(row["Payment Date"]) || parseDate(row["Created On"]) || null;
    const paymentFor = row["Payment For"]?.trim() || null;
    const remarks = row["Remarks"]?.trim() || null;

    toCreate++;
    if (APPLY) {
      const payment = await prisma.payment.create({
        data: {
          userId: user.id,
          memberTicketId: ticket.id,
          locationId: ticket.locationId ?? fallbackLocation.id,
          amount: 0,
          paymentMode: "complimentary",
          paymentNote: remarks,
          collectedById: fallbackWorker.id,
          paymentFor,
          createdAt: paymentDate || undefined,
        },
      });
      await prisma.invoice.create({
        data: {
          invoiceNumber: fbInvoice,
          userId: user.id,
          paymentId: payment.id,
          route: "membership",
          status: "paid",
          createdAt: paymentDate || undefined,
        },
      });
      created++;
    } else if (toCreate <= 5) {
      console.log(`  would create payment ${fbInvoice} for user#${user.id} ${user.firstname} ticket#${ticket.id}`);
    }
  }

  console.log("\nSummary:");
  console.log(`  zero-amount CSV rows  : ${zeroRows}`);
  console.log(`  to create             : ${toCreate}`);
  console.log(`  created               : ${created}`);
  console.log(`  skipped (dup invoice) : ${skippedDup}`);
  console.log(`  skipped (no user)     : ${skippedNoUser}`);
  console.log(`  skipped (no ticket)   : ${skippedNoTicket}`);
  if (!APPLY && toCreate > 0) console.log(`\nRun with --apply to commit ${toCreate} new Payment+Invoice rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
