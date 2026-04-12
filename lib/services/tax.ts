import { prisma } from "@/lib/prisma";

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
