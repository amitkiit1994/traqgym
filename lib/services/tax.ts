import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";

export function calculateTax(
  amount: number,
  taxRate: number,
  inclusive: boolean
): { baseAmount: number; taxAmount: number; totalAmount: number } {
  if (taxRate <= 0) {
    return { baseAmount: amount, taxAmount: 0, totalAmount: amount };
  }

  if (inclusive) {
    // Price includes GST: base = amount / (1 + rate/100)
    const baseAmount = Math.round((amount / (1 + taxRate / 100)) * 100) / 100;
    const taxAmount = Math.round((amount - baseAmount) * 100) / 100;
    return { baseAmount, taxAmount, totalAmount: amount };
  } else {
    // GST added on top
    const taxAmount = Math.round((amount * taxRate / 100) * 100) / 100;
    return { baseAmount: amount, taxAmount, totalAmount: Math.round((amount + taxAmount) * 100) / 100 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tax-inclusive GST split for Payment ledger.
//
// All TraqGym plan/PT/POS prices are tax-INCLUSIVE — the rupee value the member
// pays already contains GST. The Payment table stores the split so Tally and
// GSTR-1 exports (lib/services/tally-export.ts, gstr1-export.ts) can emit the
// correct base + tax breakdown instead of silently zero-ing out tax.
//
// Use Prisma.Decimal throughout to avoid binary-float drift on paise; the
// invariant `baseAmount + taxAmount === amount` must hold exactly. Mirrors the
// algorithm refund.ts uses on the reversal side.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_GST_RATE = 18;

/** Read & validate the gym's configured GST rate. Falls back to 18% on bad input. */
export async function getGymGstRate(): Promise<number> {
  const raw = await getSetting("gym_gst_rate", String(DEFAULT_GST_RATE));
  const n = parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_GST_RATE;
}

export type GstSplit = {
  baseAmount: number;
  taxRate: number;
  taxAmount: number;
};

/**
 * Compute the tax-inclusive GST split for a payment amount.
 *
 * - Zero / negative amounts → all-zero split (used for complimentary tickets).
 * - Zero rate → base = amount, tax = 0 (gym not registered for GST).
 * - Otherwise: tax-inclusive math, rounded HALF_UP to paise; tax is computed
 *   as `amount - base` so the two halves always sum to the input exactly.
 *
 * Caller passes a pre-resolved rate (typically from getGymGstRate()) so that
 * callsites which do many payment.create()s in a tight loop (e.g. POS bulk
 * sale) can fetch the setting once and reuse the rate.
 */
export function computeGstSplitInclusive(
  amount: number,
  gstRate: number
): GstSplit {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { baseAmount: 0, taxRate: gstRate, taxAmount: 0 };
  }
  if (!Number.isFinite(gstRate) || gstRate <= 0) {
    return { baseAmount: amount, taxRate: 0, taxAmount: 0 };
  }

  const total = new Prisma.Decimal(amount.toString());
  const divisor = new Prisma.Decimal(1).plus(
    new Prisma.Decimal(gstRate).div(100)
  );
  const baseAmountDec = total
    .div(divisor)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const taxAmountDec = total.minus(baseAmountDec);

  return {
    baseAmount: baseAmountDec.toNumber(),
    taxRate: gstRate,
    taxAmount: taxAmountDec.toNumber(),
  };
}

/** Convenience wrapper: fetch the rate and return the split in one call. */
export async function gstSplitForAmount(amount: number): Promise<GstSplit> {
  const rate = await getGymGstRate();
  return computeGstSplitInclusive(amount, rate);
}

export async function getTaxSettings() {
  const settings = await prisma.gymSettings.findMany({
    where: {
      key: { in: ["default_tax_rate", "tax_inclusive", "gym_gstin"] },
    },
  });

  const map = new Map(settings.map((s) => [s.key, s.value]));

  return {
    taxRate: parseFloat(map.get("default_tax_rate") || "0"),
    inclusive: map.get("tax_inclusive") === "true",
    gstin: map.get("gym_gstin") || null,
  };
}

export async function getTaxReport(startDate: string, endDate: string, locationId?: number) {
  const where: Record<string, unknown> = {
    createdAt: {
      gte: new Date(startDate),
      lte: new Date(endDate + "T23:59:59.999Z"),
    },
    taxAmount: { not: null, gt: 0 },
  };
  if (locationId) where.locationId = locationId;

  const payments = await prisma.payment.findMany({
    where,
    select: {
      baseAmount: true,
      taxRate: true,
      taxAmount: true,
      amount: true,
      createdAt: true,
    },
  });

  const totalBase = payments.reduce((sum, p) => sum + (p.baseAmount ? Number(p.baseAmount) : 0), 0);
  const totalTax = payments.reduce((sum, p) => sum + (p.taxAmount ? Number(p.taxAmount) : 0), 0);
  const totalAmount = payments.reduce((sum, p) => sum + Number(p.amount), 0);

  // Group by tax rate
  const byRate = new Map<number, { count: number; taxCollected: number }>();
  for (const p of payments) {
    const rate = p.taxRate ? Number(p.taxRate) : 0;
    const entry = byRate.get(rate) || { count: 0, taxCollected: 0 };
    entry.count++;
    entry.taxCollected += p.taxAmount ? Number(p.taxAmount) : 0;
    byRate.set(rate, entry);
  }

  return {
    totalBase: Math.round(totalBase * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
    totalAmount: Math.round(totalAmount * 100) / 100,
    transactionCount: payments.length,
    byRate: Array.from(byRate.entries()).map(([rate, data]) => ({
      rate,
      count: data.count,
      taxCollected: Math.round(data.taxCollected * 100) / 100,
    })),
  };
}
