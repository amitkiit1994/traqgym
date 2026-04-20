/**
 * Recover the ~3,081 payment rows present in FINAL_payments_all.csv but
 * missing from the EGYM prod DB. Conservative: only writes Payment+Invoice
 * when a matching User AND a matching MemberTicket both already exist.
 * Does NOT auto-create users or tickets — those gaps need separate review.
 *
 * Why: pg_dump load was incomplete for two reasons we identified:
 *   - 1,141 mystery 2017 rows that pre-date the active member set
 *   - 113 invoice-collapsed rows that were silently de-duped
 * Together this is ~₹84.8L of payment value that owner can't see in
 * collections / P&L / cashflow reports.
 *
 * Match keys (in priority order):
 *   user   = User.phone == cleanPhone(CSV "Contact No")
 *   ticket = newest MemberTicket for user where buyDate matches CSV "StartDate" (±2d), else newest ticket overall
 *   dedupe = Invoice.invoiceNumber == `EGL-{CSV InvoiceNo}` already present
 *
 * Idempotent: skipped rows aren't retried until --apply commits them. Re-run
 * after --apply produces zero new writes.
 *
 * Default mode: --dry-run. Pass --apply to write.
 *
 * Usage:
 *   DATABASE_URL=...prod-egym... npx tsx scripts/recover-missing-payments-egym.ts
 *   DATABASE_URL=...prod-egym... npx tsx scripts/recover-missing-payments-egym.ts --apply
 */

import { PrismaClient } from "@prisma/client";
import { parse } from "csv-parse/sync";
import fs from "fs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CSV_PATH =
  "/Users/amitkumardas/freeformOS/freeformfitnessOS/egymlokhandwala-data-export/FINAL_payments_all.csv";

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
  const ddmm = s.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (ddmm) {
    const d = new Date(`${ddmm[3]}-${ddmm[2]}-${ddmm[1]}T${ddmm[4]}:${ddmm[5]}:${ddmm[6]}`);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function normalizeMode(raw: string | undefined): string {
  const s = (raw || "").toLowerCase().trim();
  const primary = s.split(",")[0].trim();
  if (primary === "cash") return "cash";
  if (["google pay", "gpay", "paytm", "phonepe", "upi"].includes(primary)) return "upi";
  if (primary === "cheque") return "cheque";
  if (primary === "credit card") return "credit_card";
  if (primary === "debit card") return "debit_card";
  if (primary === "neft / rtgs" || primary === "neft/rtgs") return "bank_transfer";
  return primary || "cash";
}

async function main() {
  console.log(`[recover-missing-payments-egym] mode=${APPLY ? "APPLY" : "DRY-RUN"}`);
  const content = fs.readFileSync(CSV_PATH, "utf-8");
  const rows: Record<string, string>[] = parse(content, {
    columns: true, skip_empty_lines: true, trim: true, relax_column_count: true,
  });

  const fallbackWorker = await prisma.worker.findFirst({ orderBy: { id: "asc" } });
  if (!fallbackWorker) throw new Error("No Worker rows");
  const fallbackLocation = await prisma.location.findFirst({ orderBy: { id: "asc" } });
  if (!fallbackLocation) throw new Error("No Location rows");

  // Build a {normalized name -> Worker.id} map so CSV "Created By" / "SalesRep"
  // can attach the original collector. Falls back to fallbackWorker only when
  // CSV name is empty / not in worker list (e.g. "Administrator").
  const workers = await prisma.worker.findMany({ select: { id: true, firstname: true, lastname: true } });
  const wmap = new Map<string, number>();
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const w of workers) {
    const full = norm(`${w.firstname ?? ""} ${w.lastname ?? ""}`);
    if (full) wmap.set(full, w.id);
    const fn = norm(w.firstname ?? "");
    if (fn && !wmap.has(fn)) wmap.set(fn, w.id);
  }
  function findWorkerId(name: string | undefined): number | null {
    if (!name) return null;
    const k = norm(name);
    if (!k || k === "administrator") return null;
    return wmap.get(k) ?? null;
  }
  let collectorMatched = 0;
  let collectorFallback = 0;

  // Bulk-load: per-row queries against Railway take hours. Pull everything once.
  console.log("  bulk-loading invoices, users, tickets...");
  const existingInvoices = await prisma.invoice.findMany({
    where: { invoiceNumber: { startsWith: "EGL-" } },
    select: { invoiceNumber: true },
  });
  const existingInvSet = new Set(existingInvoices.map((i) => i.invoiceNumber));

  const allUsers = await prisma.user.findMany({ select: { id: true, phone: true } });
  const userByPhone = new Map<string, number>();
  for (const u of allUsers) {
    if (u.phone) userByPhone.set(u.phone, u.id);
  }

  const allTickets = await prisma.memberTicket.findMany({
    select: { id: true, userId: true, locationId: true, buyDate: true },
    orderBy: { buyDate: "desc" },
  });
  const ticketsByUser = new Map<number, typeof allTickets>();
  for (const t of allTickets) {
    if (!ticketsByUser.has(t.userId)) ticketsByUser.set(t.userId, []);
    ticketsByUser.get(t.userId)!.push(t);
  }
  console.log(`  loaded ${existingInvSet.size} invoices, ${userByPhone.size} phones, ${allTickets.length} tickets`);

  let total = 0;
  let noInvoice = 0;
  let alreadyPresent = 0;
  let noUser = 0;
  let noTicket = 0;
  let toCreate = 0;
  let created = 0;
  let recoveredAmount = 0;

  type PendingRow = {
    fbInvoice: string;
    userId: number;
    ticketId: number;
    locationId: number;
    amount: number;
    mode: string;
    remarks: string | null;
    paymentFor: string | null;
    discount: number;
    collectedById: number;
    paymentDate: Date | null;
  };
  const pending: PendingRow[] = [];

  for (const row of rows) {
    total++;
    const inv = row["InvoiceNo"]?.trim();
    if (!inv) { noInvoice++; continue; }
    const fbInvoice = `EGL-${inv}`;

    if (existingInvSet.has(fbInvoice)) { alreadyPresent++; continue; }

    const phone = cleanPhone(row["Contact No"]);
    if (!phone || phone.length < 7) { noUser++; continue; }
    const userId = userByPhone.get(phone);
    if (!userId) { noUser++; continue; }

    const startDate = parseDate(row["StartDate"]) || null;
    const userTickets = ticketsByUser.get(userId) ?? [];
    let ticket: { id: number; locationId: number | null } | null = null;
    if (startDate && userTickets.length) {
      const lo = startDate.getTime() - 2 * 86400000;
      const hi = startDate.getTime() + 2 * 86400000;
      const m = userTickets.find((t) => {
        const ts = t.buyDate.getTime();
        return ts >= lo && ts <= hi;
      });
      if (m) ticket = { id: m.id, locationId: m.locationId };
    }
    if (!ticket && userTickets.length) {
      ticket = { id: userTickets[0].id, locationId: userTickets[0].locationId };
    }
    if (!ticket) { noTicket++; continue; }

    const amount = Number((row["Paid Amount"] || "").replace(/[, ]/g, ""));
    if (!isFinite(amount) || amount < 0) continue;
    const paymentDate = parseDate(row["Payment Date"]) || parseDate(row["Created On"]) || null;
    const mode = amount === 0 ? "complimentary" : normalizeMode(row["Payment Mode"]);
    const remarks = row["Remarks"]?.trim() || null;
    const paymentFor = row["Payment For"]?.trim() || null;
    const discount = Number((row["Discount"] || "").replace(/[, ]/g, "")) || 0;

    const collectedById =
      findWorkerId(row["Created By"]) ??
      findWorkerId(row["SalesRep"]) ??
      fallbackWorker.id;
    if (collectedById === fallbackWorker.id) collectorFallback++;
    else collectorMatched++;

    toCreate++;
    recoveredAmount += amount;

    pending.push({
      fbInvoice,
      userId,
      ticketId: ticket.id,
      locationId: ticket.locationId ?? fallbackLocation.id,
      amount,
      mode,
      remarks,
      paymentFor,
      discount,
      collectedById,
      paymentDate,
    });

    if (!APPLY && toCreate <= 5) {
      console.log(`  would create ${fbInvoice}: user#${userId} ticket#${ticket.id} amount=${amount} mode=${mode}`);
    }
  }

  // Sequential per-row creates over Railway disconnect mid-run; batch via
  // interactive $transaction (chunks of 100) so we can chain payment->invoice
  // (Invoice needs Payment.id) within one round-trip per chunk.
  if (APPLY && pending.length) {
    const BATCH = 25;
    for (let i = 0; i < pending.length; i += BATCH) {
      const chunk = pending.slice(i, i + BATCH);
      await prisma.$transaction(async (tx) => {
        for (const p of chunk) {
          const payment = await tx.payment.create({
            data: {
              userId: p.userId,
              memberTicketId: p.ticketId,
              locationId: p.locationId,
              amount: p.amount,
              paymentMode: p.mode,
              paymentNote: p.remarks,
              collectedById: p.collectedById,
              discount: p.discount > 0 ? p.discount : null,
              paymentFor: p.paymentFor,
              createdAt: p.paymentDate || undefined,
            },
          });
          await tx.invoice.create({
            data: {
              invoiceNumber: p.fbInvoice,
              userId: p.userId,
              paymentId: payment.id,
              route: "membership",
              status: "paid",
              createdAt: p.paymentDate || undefined,
            },
          });
        }
      }, { timeout: 180000, maxWait: 30000 });
      created += chunk.length;
      console.log(`  ...applied ${created}/${pending.length}`);
    }
  }

  console.log("\nSummary:");
  console.log(`  CSV rows scanned       : ${total}`);
  console.log(`  no invoice number      : ${noInvoice}`);
  console.log(`  already present in DB  : ${alreadyPresent}`);
  console.log(`  no user match          : ${noUser}`);
  console.log(`  no ticket match        : ${noTicket}`);
  console.log(`  to create              : ${toCreate}`);
  console.log(`  created                : ${created}`);
  console.log(`  recovered ₹            : ${recoveredAmount.toFixed(2)}`);
  console.log(`  collector matched      : ${collectorMatched}`);
  console.log(`  collector -> fallback  : ${collectorFallback}`);
  if (!APPLY && toCreate > 0) console.log(`\nRun with --apply to commit ${toCreate} new Payment+Invoice rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
