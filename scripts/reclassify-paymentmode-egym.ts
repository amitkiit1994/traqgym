/**
 * Reclassify EGYM Payment.paymentMode using the source CSV as truth.
 *
 * Why: pg_dump load collapsed every non-cash mode (GPay 1295, Paytm 14,
 * PhonePe 9, Cheque 690, Credit/Debit Card 380, NEFT 86, "Simca" 91 etc.)
 * down to "cash" or left them as the raw CSV string. Reports show ~₹81L of
 * GPay/Paytm flowing through the cash bucket, which is the largest single
 * data error owner has flagged.
 *
 * This script reads FINAL_payments_all.csv, normalizes Payment Mode, and
 * UPDATEs Payment.paymentMode wherever the CSV value differs from DB. Match
 * key is Invoice.invoiceNumber == `EGL-{InvoiceNo}` -> Invoice.paymentId.
 *
 * Idempotent: only updates rows that differ. Re-run = no-op.
 * Default mode: --dry-run. Pass --apply to write.
 *
 * Usage:
 *   DATABASE_URL=...prod-egym... npx tsx scripts/reclassify-paymentmode-egym.ts
 *   DATABASE_URL=...prod-egym... npx tsx scripts/reclassify-paymentmode-egym.ts --apply
 */

import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import fs from "fs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CSV_PATH =
  "/Users/amitkumardas/freeformOS/freeformfitnessOS/egymlokhandwala-data-export/FINAL_payments_all.csv";

// CSV → normalized mode used in TraqGym (see lib/services/dashboard.ts cash/upi filters).
function normalizeMode(raw: string | undefined): string | null {
  const s = (raw || "").toLowerCase().trim();
  if (!s || s === "n/a") return null;
  // Mixed rows like "cash,google pay" — primary intent is the FIRST mode.
  const primary = s.split(",")[0].trim();
  if (primary === "cash") return "cash";
  if (["google pay", "gpay", "paytm", "phonepe", "upi"].includes(primary)) return "upi";
  if (primary === "cheque") return "cheque";
  if (primary === "credit card") return "credit_card";
  if (primary === "debit card") return "debit_card";
  if (primary === "neft / rtgs" || primary === "neft/rtgs" || primary === "neft" || primary === "rtgs") return "bank_transfer";
  if (primary === "simca") return "simca"; // EGYM-specific gateway, leave verbatim
  // Reject anything we don't recognize. CSV "Payment Mode" sometimes carries
  // staff names or junk (e.g. "pradeep", "card") — overwriting a real mode
  // ("cash") with that garbage would corrupt reports. Skip = leave DB unchanged.
  return null;
}

async function main() {
  console.log(`[reclassify-paymentmode-egym] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  const content = fs.readFileSync(CSV_PATH, "utf-8");
  const rows: Record<string, string>[] = parse(content, {
    columns: true, skip_empty_lines: true, trim: true, relax_column_count: true,
  });

  let total = 0;
  let noInvoice = 0;
  let invoiceNotFound = 0;
  let already = 0;
  let toUpdate = 0;
  let updated = 0;
  const transitions = new Map<string, number>();
  const sample: string[] = [];

  // Bulk-load: one query each for invoices and payments, then in-memory join.
  // Sequential per-row queries cost ~30k Railway round-trips and time out.
  console.log("  loading invoices + payments into memory...");
  const invoices = await prisma.invoice.findMany({
    where: { invoiceNumber: { startsWith: "EGL-" } },
    select: { invoiceNumber: true, paymentId: true },
  });
  const invoiceByKey = new Map<string, number>();
  for (const i of invoices) {
    if (i.paymentId) invoiceByKey.set(i.invoiceNumber, i.paymentId);
  }
  const payments = await prisma.payment.findMany({
    where: { id: { in: [...invoiceByKey.values()] } },
    select: { id: true, paymentMode: true },
  });
  const paymentById = new Map<number, string | null>();
  for (const p of payments) paymentById.set(p.id, p.paymentMode);
  console.log(`  loaded ${invoices.length} invoices, ${payments.length} payments`);

  const BATCH = 500;
  let pending: { id: number; mode: string }[] = [];

  async function flush() {
    if (!pending.length) return;
    if (APPLY) {
      await prisma.$transaction(
        pending.map((p) => prisma.payment.update({ where: { id: p.id }, data: { paymentMode: p.mode } })),
      );
      updated += pending.length;
      if (updated % 1000 === 0 || updated === toUpdate) console.log(`  ...applied ${updated}/${toUpdate}`);
    }
    pending = [];
  }

  for (const row of rows) {
    total++;
    const inv = row["InvoiceNo"]?.trim();
    if (!inv) { noInvoice++; continue; }
    const target = normalizeMode(row["Payment Mode"]);
    if (!target) continue;

    const paymentId = invoiceByKey.get(`EGL-${inv}`);
    if (!paymentId) { invoiceNotFound++; continue; }
    const currentRaw = paymentById.get(paymentId);
    if (currentRaw === undefined) { invoiceNotFound++; continue; }

    const current = (currentRaw || "").toLowerCase().trim();
    if (current === target) { already++; continue; }

    toUpdate++;
    const key = `${current || "(null)"} -> ${target}`;
    transitions.set(key, (transitions.get(key) ?? 0) + 1);
    if (sample.length < 8) sample.push(`  payment#${paymentId} ${key}`);

    pending.push({ id: paymentId, mode: target });
    if (pending.length >= BATCH) await flush();
  }
  await flush();

  console.log("\nTransitions (CSV-truth -> what we'd write):");
  for (const [k, v] of [...transitions.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${v.toString().padStart(6)}  ${k}`);
  }
  if (sample.length) {
    console.log("\nSample updates:");
    for (const s of sample) console.log(s);
  }
  console.log("\nSummary:");
  console.log(`  CSV rows scanned       : ${total}`);
  console.log(`  rows with no invoice#  : ${noInvoice}`);
  console.log(`  invoice missing in DB  : ${invoiceNotFound}`);
  console.log(`  already correct        : ${already}`);
  console.log(`  to update              : ${toUpdate}`);
  console.log(`  applied                : ${updated}`);
  if (!APPLY && toUpdate > 0) console.log(`\nRun with --apply to commit ${toUpdate} updates.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
