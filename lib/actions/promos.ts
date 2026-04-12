"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import { promoCodeSchema, zodErrors } from "@/lib/validations";

export async function getPromoCodes() {
  try { await requireWorker(); } catch { return []; }
  const rows = await prisma.promoCode.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    ...r,
    discountValue: Number(r.discountValue),
    validFrom: r.validFrom.toISOString(),
    validTo: r.validTo.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function createPromoCode(data: {
  code: string;
  discountType: string;
  discountValue: number;
  maxUses?: number;
  validFrom: string;
  validTo: string;
  planIds?: string;
}) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = promoCodeSchema.safeParse(data);
  if (!parsed.success) return { error: Object.values(zodErrors(parsed.error))[0] };

  const existing = await prisma.promoCode.findUnique({ where: { code: data.code.trim().toUpperCase() } });
  if (existing) return { error: "Code already exists" };

  await prisma.promoCode.create({
    data: {
      code: data.code.trim().toUpperCase(),
      discountType: data.discountType,
      discountValue: data.discountValue,
      maxUses: data.maxUses || null,
      validFrom: new Date(data.validFrom),
      validTo: new Date(data.validTo),
      planIds: data.planIds?.trim() || null,
    },
  });

  revalidatePath("/admin/promos");
  return { success: true };
}

export async function togglePromoCode(id: number, isActive: boolean) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  await prisma.promoCode.update({ where: { id }, data: { isActive } });
  revalidatePath("/admin/promos");
  return { success: true };
}

export async function validatePromoCode(code: string, planId: number) {
  try { await requireWorker(); } catch { return { valid: false, error: "Unauthorized" }; }
  const promo = await prisma.promoCode.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!promo) return { valid: false, error: "Promo code not found" };
  if (!promo.isActive) return { valid: false, error: "Promo code is inactive" };

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (now < promo.validFrom || now > promo.validTo)
    return { valid: false, error: "Promo code has expired" };

  if (promo.maxUses && promo.usedCount >= promo.maxUses)
    return { valid: false, error: "Promo code usage limit reached" };

  if (promo.planIds) {
    const allowedIds = promo.planIds.split(",").map((s) => parseInt(s.trim(), 10));
    if (!allowedIds.includes(planId))
      return { valid: false, error: "Promo code not valid for this plan" };
  }

  // Calculate discount
  const plan = await prisma.ticketPlan.findUnique({ where: { id: planId } });
  if (!plan) return { valid: false, error: "Plan not found" };

  const price = Number(plan.price);
  let discount: number;
  if (promo.discountType === "percentage") {
    discount = Math.round((price * Number(promo.discountValue)) / 100);
  } else {
    discount = Number(promo.discountValue);
  }
  discount = Math.min(discount, price);

  return {
    valid: true,
    discount,
    finalPrice: price - discount,
    discountType: promo.discountType,
    discountValue: Number(promo.discountValue),
  };
}

export async function applyPromoCode(code: string) {
  try { await requireWorker(); } catch { return; }
  await prisma.promoCode.update({
    where: { code: code.trim().toUpperCase() },
    data: { usedCount: { increment: 1 } },
  });
}
