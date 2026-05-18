import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { requireInternalSecret } from "@/lib/auth-internal";
import { prisma } from "@/lib/prisma";
import { setSetting } from "@/lib/services/settings";

// If more than this fraction of rows in a single sync chunk errored
// per-row, the chunk is treated as a failure (500) instead of being
// silently reported as a success. The cron alerts on non-200.
const PER_ROW_ERROR_THRESHOLD = 0.1;

/**
 * POST /api/internal/v3-sync
 *
 * Called by the nightly v3-sync GitHub Action with a chunk of rows fetched
 * from v3.fitnessboard.in. Upserts them into Postgres using stable v3 keys.
 *
 * Auth: Authorization: Bearer <INTERNAL_API_SECRET>
 *
 * Body:
 *   {
 *     dataset: "payment" | "members" | "memberships" | "balance" | ...,
 *     rows: any[],
 *   }
 *
 * v1 implements `dataset="payment"` only. Other datasets return 501 with a
 * clear message. The status of each call is persisted to GymSettings
 * (v3_last_sync_at + v3_last_sync_status) so the admin UI can show it.
 */

type Body = {
  dataset?: string;
  rows?: unknown[];
};

export async function POST(req: NextRequest) {
  const guard = requireInternalSecret(req);
  if (guard) return guard;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    await markStatus(`err: invalid JSON body`);
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const dataset = body.dataset;
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!dataset || !rows) {
    await markStatus(`err: missing dataset or rows`);
    return NextResponse.json({ error: "missing dataset or rows" }, { status: 400 });
  }

  try {
    switch (dataset) {
      case "payment": {
        const result = await upsertPayments(rows);
        if (isOverErrorThreshold(result.errors, rows.length)) {
          await markStatus(`err: ${result.errors}/${rows.length} payment rows errored — failing chunk`);
          return NextResponse.json({ error: "too many per-row errors", dataset, ...result }, { status: 500 });
        }
        await markStatus(`ok: ${result.inserted} payments inserted, ${result.skipped} skipped${result.errors ? `, ${result.errors} errors` : ""}`);
        return NextResponse.json({ success: true, dataset, ...result });
      }
      case "balance": {
        const result = await upsertBalances(rows);
        if (isOverErrorThreshold(result.errors, rows.length)) {
          await markStatus(`err: ${result.errors}/${rows.length} balance rows errored — failing chunk`);
          return NextResponse.json({ error: "too many per-row errors", dataset, ...result }, { status: 500 });
        }
        await markStatus(`ok: ${result.updated} balances updated, ${result.skipped} skipped${result.errors ? `, ${result.errors} errors` : ""}`);
        return NextResponse.json({ success: true, dataset, ...result });
      }
      case "attendance": {
        const result = await upsertAttendance(rows);
        if (isOverErrorThreshold(result.errors, rows.length)) {
          await markStatus(`err: ${result.errors}/${rows.length} attendance rows errored — failing chunk`);
          return NextResponse.json({ error: "too many per-row errors", dataset, ...result }, { status: 500 });
        }
        await markStatus(`ok: ${result.inserted} attendance inserted, ${result.skipped} skipped${result.errors ? `, ${result.errors} errors` : ""}`);
        return NextResponse.json({ success: true, dataset, ...result });
      }
      case "members":
      case "memberships":
      case "memberDetails":
      case "invoices":
        return NextResponse.json(
          {
            error: `Dataset '${dataset}' is not yet implemented in the v3-sync API`,
            hint: "v1 supports dataset=payment, balance, attendance.",
          },
          { status: 501 }
        );
      default:
        return NextResponse.json({ error: `Unknown dataset '${dataset}'` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[v3-sync] upsert error:", err);
    await markStatus(`err: ${message}`);
    return NextResponse.json({ error: "sync failed", details: message }, { status: 500 });
  }
}

/**
 * Idempotent payment upsert keyed on the v3 BillNo / InvoiceNo. We mint
 * an invoice number `FB-{BillNo}` (matching the existing migrate script's
 * convention) and only create rows where that invoice number doesn't yet
 * exist — guarantees a re-run won't double-count.
 *
 * Rows are expected to look like (from v3 ExportToExcel "payment" report
 * or the BillPaymentReports AJAX endpoint):
 *   {
 *     BillNo: string,                   // a.k.a. InvoiceNo
 *     MemberId?: string | number,       // for matching to users.phone
 *     ContactNo?: string,
 *     Amount: string | number,
 *     PaymentMode?: string,
 *     PaymentDate?: string,             // ISO or DD-MM-YYYY
 *     PaymentFor?: string,
 *     Remarks?: string,
 *   }
 */
async function upsertPayments(rows: unknown[]): Promise<{
  inserted: number;
  skipped: number;
  skippedBreakdown: { noBillNo: number; alreadyExists: number; negativeAmount: number; noPhone: number; userCreateFailed: number };
  createdUsers: number;
  errors: number;
}> {
  let inserted = 0;
  let createdUsers = 0;
  let errors = 0;
  let skippedNoBillNo = 0;
  let skippedAlreadyExists = 0;
  let skippedNegativeAmount = 0;
  let skippedNoPhone = 0;
  let skippedUserCreateFailed = 0;

  // Pick the first worker as a fallback for the collectedBy FK. v3 doesn't
  // tell us *who* the actual cashier was, so this is a best-effort marker.
  const fallback = await prisma.worker.findFirst({
    where: { isActive: true },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!fallback) {
    throw new Error("No active workers found — cannot attribute v3 payments to a collector.");
  }

  for (const raw of rows) {
    try {
      const row = raw as Record<string, unknown>;
      const billNo = String(row.BillNo ?? row.InvoiceNo ?? "").trim();
      if (!billNo) {
        skippedNoBillNo++;
        continue;
      }
      const fbInvoice = `FB-${billNo}`;
      const existing = await prisma.invoice.findFirst({
        where: { invoiceNumber: fbInvoice },
        select: { id: true, paymentId: true, payment: { select: { id: true, trainerId: true } } },
      });
      if (existing) {
        // Payment already inserted on a prior sync — but back-fill trainerId
        // if it's still null (earlier sync versions didn't write trainerId).
        if (existing.payment && existing.payment.trainerId == null) {
          const trainerName = String(row.Trainer ?? "").trim();
          if (trainerName) {
            const tokens = trainerName.split(/\s+/).filter((t) => t.length > 0);
            const trainerWorker = await prisma.worker.findFirst({
              where: {
                isActive: true,
                AND: tokens.map((t) => ({
                  OR: [
                    { firstname: { equals: t, mode: "insensitive" as const } },
                    { lastname: { equals: t, mode: "insensitive" as const } },
                    { firstname: { contains: t, mode: "insensitive" as const } },
                    { lastname: { contains: t, mode: "insensitive" as const } },
                  ],
                })),
              },
              select: { id: true },
            });
            if (trainerWorker) {
              await prisma.payment.update({
                where: { id: existing.payment.id },
                data: { trainerId: trainerWorker.id },
              });
            }
          }
        }
        skippedAlreadyExists++;
        continue;
      }

      const amount = parseDecimal(row.Amount);
      if (amount < 0) {
        skippedNegativeAmount++;
        continue;
      }

      const phone = normalisePhone(row.ContactNo ?? row.Mobile);
      if (!phone) {
        // No phone → can't even create a placeholder user. Skip.
        skippedNoPhone++;
        continue;
      }

      let user = await prisma.user.findFirst({
        where: { phone },
        select: { id: true, locationId: true },
      });

      if (!user) {
        // Auto-create a placeholder user — matches the migrate-fitnessboard.ts
        // convention so the v3 → TraqGym sync is complete rather than partial.
        const billingName = String(row.BillingName ?? row.Name ?? "v3 member").trim() || "v3 member";
        const nameParts = billingName.split(/\s+/);
        const firstname = nameParts[0] || "v3";
        const lastname = nameParts.slice(1).join(" ") || "member";
        const placeholderEmail = `${phone}@imported.local`;
        const hashedPassword = await bcrypt.hash(phone, 10);
        const defaultLocation = await prisma.location.findFirst({
          orderBy: { id: "asc" },
          select: { id: true },
        });

        try {
          user = await prisma.user.create({
            data: {
              firstname,
              lastname,
              phone,
              email: placeholderEmail,
              password: hashedPassword,
              locationId: defaultLocation?.id ?? null,
            },
            select: { id: true, locationId: true },
          });
          createdUsers++;
        } catch (err) {
          // Only treat unique-constraint violations as the expected race
          // (another concurrent row created the user). Anything else
          // (connection drop, validation, FK violation) is a real failure
          // and must bubble up so the chunk's error counter fires.
          if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
            throw err;
          }
          user = await prisma.user.findFirst({
            where: { phone },
            select: { id: true, locationId: true },
          });
          if (!user) {
            skippedUserCreateFailed++;
            continue;
          }
        }
      }

      const paymentDate = parseV3Date(row.PaymentDate);

      // Prefer the ticket whose date-window contains the paymentDate — that's
      // the ticket this payment was actually for. Fall back to the most-recent
      // ticket only if no date match. Stuffing every historical payment onto
      // the newest ticket (the old behaviour) silently inflated amountPaid on
      // newest tickets and produced ~₹7Cr of phantom "drift" on egym, which
      // the detect_balance_mismatches detector then surfaced as fake fraud.
      //
      // A second pass extends the expireDate window by 30 days to catch
      // legitimate late renewals (a payment recorded 2 weeks after the
      // ticket expired, settling balance) before falling back to most-recent.
      let ticket = paymentDate
        ? await prisma.memberTicket.findFirst({
            where: {
              userId: user.id,
              buyDate: { lte: paymentDate },
              expireDate: { gte: paymentDate },
            },
            orderBy: { buyDate: "desc" },
            select: { id: true },
          })
        : null;
      if (!ticket && paymentDate) {
        const windowStart = new Date(paymentDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        ticket = await prisma.memberTicket.findFirst({
          where: {
            userId: user.id,
            buyDate: { lte: paymentDate },
            expireDate: { gte: windowStart },
          },
          orderBy: { buyDate: "desc" },
          select: { id: true },
        });
      }
      if (!ticket) {
        ticket = await prisma.memberTicket.findFirst({
          where: { userId: user.id },
          orderBy: { buyDate: "desc" },
          select: { id: true },
        });
      }
      const mode = mapPaymentMode(row.PaymentMode);

      // Resolve v3's Trainer string ("afzal", "Floor Trainers", etc.) to a
      // Worker row by full-name match. Falls back to null so payment goes
      // through without a trainer rather than being dropped.
      const trainerName = String(row.Trainer ?? "").trim();
      let trainerId: number | null = null;
      if (trainerName) {
        const tokens = trainerName.split(/\s+/).filter((t) => t.length > 0);
        const trainerWorker = await prisma.worker.findFirst({
          where: {
            isActive: true,
            AND: tokens.map((t) => ({
              OR: [
                { firstname: { equals: t, mode: "insensitive" as const } },
                { lastname: { equals: t, mode: "insensitive" as const } },
                { firstname: { contains: t, mode: "insensitive" as const } },
                { lastname: { contains: t, mode: "insensitive" as const } },
              ],
            })),
          },
          select: { id: true },
        });
        trainerId = trainerWorker?.id ?? null;
      }

      const payment = await prisma.payment.create({
        data: {
          userId: user.id,
          memberTicketId: ticket?.id ?? null,
          locationId: user.locationId,
          amount,
          paymentMode: amount === 0 ? "complimentary" : mode,
          paymentNote: stringOrNull(row.Remarks),
          paymentFor: stringOrNull(row.PaymentFor),
          collectedById: fallback.id,
          trainerId,
          createdAt: paymentDate ?? undefined,
        },
      });

      await prisma.invoice.create({
        data: {
          invoiceNumber: fbInvoice,
          userId: user.id,
          paymentId: payment.id,
          route: "membership",
          status: "paid",
          createdAt: paymentDate ?? undefined,
        },
      });

      inserted++;
    } catch (err) {
      errors++;
      console.error("[v3-sync] row error:", err);
    }
  }

  const skipped =
    skippedNoBillNo +
    skippedAlreadyExists +
    skippedNegativeAmount +
    skippedNoPhone +
    skippedUserCreateFailed;

  return {
    inserted,
    skipped,
    skippedBreakdown: {
      noBillNo: skippedNoBillNo,
      alreadyExists: skippedAlreadyExists,
      negativeAmount: skippedNegativeAmount,
      noPhone: skippedNoPhone,
      userCreateFailed: skippedUserCreateFailed,
    },
    createdUsers,
    errors,
  };
}

/**
 * Upsert outstanding balance data from v3's balance report into the
 * member's most-recent ticket. We don't track historic balance snapshots
 * (yet) — this just overwrites MemberTicket.balanceDue with v3's
 * current authoritative value.
 *
 * Rows expected:
 *   { MemberId?, ContactNo, MemberName?, BalanceAmount, ... }
 */
async function upsertBalances(rows: unknown[]): Promise<{
  updated: number;
  skipped: number;
  errors: number;
  skippedBreakdown: { noPhone: number; userNotFound: number; noTicket: number };
}> {
  let updated = 0;
  let errors = 0;
  let skippedNoPhone = 0;
  let skippedUserNotFound = 0;
  let skippedNoTicket = 0;

  for (const raw of rows) {
    try {
      const row = raw as Record<string, unknown>;
      const phone = normalisePhone(row.ContactNo ?? row.Mobile);
      if (!phone) {
        skippedNoPhone++;
        continue;
      }
      const user = await prisma.user.findFirst({
        where: { phone },
        select: { id: true },
      });
      if (!user) {
        skippedUserNotFound++;
        continue;
      }
      // V3's BalanceAmount is "current outstanding right now", so prefer
      // the ticket that's actually active today (the balance applies to
      // it, not to a future-dated or long-expired ticket). Fall back to
      // most-recent only if no active ticket. Mirrors the upsertPayments
      // attribution fix — without this, the balance silently lands on
      // whichever ticket happens to have the latest buyDate, recreating
      // the phantom-drift pattern on the balance side.
      const now = new Date();
      let ticket = await prisma.memberTicket.findFirst({
        where: {
          userId: user.id,
          buyDate: { lte: now },
          expireDate: { gte: now },
        },
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
      if (!ticket) {
        skippedNoTicket++;
        continue;
      }
      const newBalance = parseDecimal(row.BalanceAmount);
      // Only update if value actually changed (avoid no-op write churn).
      if (Number(ticket.balanceDue) === newBalance) {
        continue;
      }
      await prisma.memberTicket.update({
        where: { id: ticket.id },
        data: { balanceDue: newBalance },
      });
      updated++;
    } catch (err) {
      errors++;
      console.error("[v3-sync balance] row error:", err);
    }
  }

  const skipped = skippedNoPhone + skippedUserNotFound + skippedNoTicket;
  return {
    updated,
    skipped,
    errors,
    skippedBreakdown: {
      noPhone: skippedNoPhone,
      userNotFound: skippedUserNotFound,
      noTicket: skippedNoTicket,
    },
  };
}

/**
 * Upsert v3 attendance rows into AttendanceLog. Idempotent — dedupe key
 * is (userId, attendanceDate, checkIn-minute) since v3 only gives us minute
 * resolution on check-in time.
 *
 * Rows expected: { MemberId?, ContactNo, MemberName, CheckIn, CheckOut, AttendanceDate }
 *   CheckIn / CheckOut / AttendanceDate may be in various v3 formats.
 */
async function upsertAttendance(rows: unknown[]): Promise<{
  inserted: number;
  skipped: number;
  errors: number;
  skippedBreakdown: { noPhone: number; userNotFound: number; dateParseFailed: number; duplicate: number; noLocation: number };
}> {
  let inserted = 0;
  let errors = 0;
  let skippedNoPhone = 0;
  let skippedUserNotFound = 0;
  let skippedDateParseFailed = 0;
  let skippedDuplicate = 0;
  let skippedNoLocation = 0;

  // Pick a default location (only one for now per gym; we'll attach there)
  const defaultLocation = await prisma.location.findFirst({
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (!defaultLocation) {
    // The gym has no Location row yet — every attendance row would be
    // rejected by the FK. Report it as its own skip reason so the caller
    // doesn't see "all duplicates" (a lie) and operators can fix the
    // missing Location before the next sync.
    return {
      inserted: 0,
      skipped: rows.length,
      errors: 0,
      skippedBreakdown: { noPhone: 0, userNotFound: 0, dateParseFailed: 0, duplicate: 0, noLocation: rows.length },
    };
  }

  for (const raw of rows) {
    try {
      const row = raw as Record<string, unknown>;
      const phone = normalisePhone(row.ContactNo ?? row.Mobile);
      if (!phone) {
        skippedNoPhone++;
        continue;
      }
      const user = await prisma.user.findFirst({
        where: { phone },
        select: { id: true, locationId: true },
      });
      if (!user) {
        skippedUserNotFound++;
        continue;
      }
      const checkInStr = String(row.CheckIn ?? "").trim();
      const checkOutStr = String(row.CheckOut ?? "").trim();
      const dateStr = String(row.AttendanceDate ?? "").trim();

      // Date may come either as part of the CheckIn string ("17-05-2026 10:30 AM")
      // or separately. Combine into best-effort timestamps.
      const checkInDt = parseV3DateTime(checkInStr) ?? parseV3Date(dateStr);
      if (!checkInDt) {
        skippedDateParseFailed++;
        continue;
      }
      const checkOutDt = checkOutStr ? parseV3DateTime(checkOutStr) : null;
      // Date portion only, truncated to UTC midnight
      const attDate = new Date(Date.UTC(checkInDt.getUTCFullYear(), checkInDt.getUTCMonth(), checkInDt.getUTCDate()));

      // Dedupe: same user + same date + same check-in minute
      const minuteFloor = new Date(checkInDt);
      minuteFloor.setSeconds(0, 0);
      const minuteCeil = new Date(minuteFloor);
      minuteCeil.setMinutes(minuteCeil.getMinutes() + 1);

      const existing = await prisma.attendanceLog.findFirst({
        where: {
          userId: user.id,
          attendanceDate: attDate,
          checkIn: { gte: minuteFloor, lt: minuteCeil },
        },
        select: { id: true },
      });
      if (existing) {
        skippedDuplicate++;
        continue;
      }

      await prisma.attendanceLog.create({
        data: {
          userId: user.id,
          locationId: user.locationId ?? defaultLocation.id,
          attendanceDate: attDate,
          checkIn: checkInDt,
          checkOut: checkOutDt,
          source: "v3-sync",
          scanSource: "v3_fitnessboard",
        },
      });
      inserted++;
    } catch (err) {
      errors++;
      console.error("[v3-sync attendance] row error:", err);
    }
  }

  const skipped = skippedNoPhone + skippedUserNotFound + skippedDateParseFailed + skippedDuplicate + skippedNoLocation;
  return {
    inserted,
    skipped,
    errors,
    skippedBreakdown: {
      noPhone: skippedNoPhone,
      userNotFound: skippedUserNotFound,
      dateParseFailed: skippedDateParseFailed,
      duplicate: skippedDuplicate,
      noLocation: skippedNoLocation,
    },
  };
}

function isOverErrorThreshold(errors: number, rowCount: number): boolean {
  if (rowCount === 0) return false;
  return errors / rowCount > PER_ROW_ERROR_THRESHOLD;
}

/**
 * Parse v3 datetime strings: 'dd-mm-yyyy hh:mm AM/PM', 'dd-mm-yyyy hh:mm:ss',
 * 'dd Mon yyyy hh:mm:ss', etc.
 */
function parseV3DateTime(s: string): Date | null {
  if (!s) return null;
  const trimmed = s.trim();
  // Try the standard date format first
  const dateOnly = parseV3Date(trimmed);
  if (dateOnly && !/[:]/.test(trimmed)) return dateOnly;
  // dd-mm-yyyy hh:mm AM/PM
  const ampm = trimmed.match(/^(\d{1,2})[\-\/](\d{1,2})[\-\/](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/);
  if (ampm) {
    const [, d, m, y, hh, mm, ss, ap] = ampm;
    let hour = parseInt(hh!, 10);
    if (ap?.toUpperCase() === "PM" && hour < 12) hour += 12;
    if (ap?.toUpperCase() === "AM" && hour === 12) hour = 0;
    return new Date(Date.UTC(parseInt(y!, 10), parseInt(m!, 10) - 1, parseInt(d!, 10), hour, parseInt(mm!, 10), ss ? parseInt(ss, 10) : 0));
  }
  // Fallback: try Date.parse
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return new Date(parsed);
  return null;
}

async function markStatus(status: string): Promise<void> {
  try {
    await setSetting("v3_last_sync_at", new Date().toISOString());
    await setSetting("v3_last_sync_status", status);
  } catch (err) {
    // Status logging must never break the response
    console.error("[v3-sync] failed to record status:", err);
  }
}

function parseDecimal(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v !== "string") return 0;
  const cleaned = v.replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function normalisePhone(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const digits = String(v).replace(/\D/g, "");
  // Drop India country code if present
  const trimmed = digits.length > 10 ? digits.slice(-10) : digits;
  return trimmed.length === 10 ? trimmed : null;
}

function parseV3Date(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  // v3 /Date(123456789)/ format
  const epoch = s.match(/^\/?Date\((-?\d+)\)\/?$/);
  if (epoch) {
    const d = new Date(parseInt(epoch[1], 10));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // DD-MM-YYYY or DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    const d = new Date(Date.UTC(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10)));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const iso = new Date(s);
  return Number.isNaN(iso.getTime()) ? null : iso;
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed || null;
}

function mapPaymentMode(v: unknown): string {
  if (typeof v !== "string") return "cash";
  const s = v.trim().toLowerCase();
  if (!s) return "cash";
  if (/upi|gpay|phonepe|paytm/.test(s)) return "upi";
  if (/card|swipe|pos/.test(s)) return "card";
  if (/cheque|check/.test(s)) return "cheque";
  if (/bank|neft|imps|transfer/.test(s)) return "bank_transfer";
  return "cash";
}
