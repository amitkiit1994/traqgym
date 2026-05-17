import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireInternalSecret } from "@/lib/auth-internal";
import { prisma } from "@/lib/prisma";
import { setSetting } from "@/lib/services/settings";

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
        await markStatus(`ok: ${result.inserted} payments inserted, ${result.skipped} skipped`);
        return NextResponse.json({ success: true, dataset, ...result });
      }
      case "members":
      case "memberships":
      case "balance":
      case "memberDetails":
      case "attendance":
      case "invoices":
        return NextResponse.json(
          {
            error: `Dataset '${dataset}' is not yet implemented in the v3-sync API`,
            hint: "v1 only supports dataset=payment. Add an upsert handler in app/api/internal/v3-sync/route.ts.",
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
        select: { id: true },
      });
      if (existing) {
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
        } catch {
          // Most likely a unique-constraint race on email/phone (another row
          // for the same member created the user just now) — re-fetch.
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

      // Attach to the user's most recent ticket if any (mirrors migrate script).
      const ticket = await prisma.memberTicket.findFirst({
        where: { userId: user.id },
        orderBy: { buyDate: "desc" },
        select: { id: true },
      });

      const paymentDate = parseV3Date(row.PaymentDate);
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
