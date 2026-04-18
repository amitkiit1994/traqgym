"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/auth-guard";
import { upgradePlan, previewUpgrade } from "@/lib/services/upgrade";

const upgradeSchema = z.object({
  memberTicketId: z.number().int().positive(),
  newPlanId: z.number().int().positive(),
  paidAmount: z.number().nonnegative(),
  paymentMode: z.string().trim().min(1, "Payment mode is required"),
  prorationMode: z.enum(["daily", "monthly", "none"]).optional(),
  upiReference: z.string().trim().optional(),
});

export async function upgradePlanAction(data: {
  memberTicketId: number;
  newPlanId: number;
  paidAmount: number;
  paymentMode: string;
  prorationMode?: "daily" | "monthly" | "none";
  upiReference?: string;
}) {
  let session;
  try {
    session = await requireWorker();
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }

  const parsed = upgradeSchema.safeParse(data);
  if (!parsed.success) {
    const firstError =
      Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] || "Validation error";
    return { success: false as const, error: firstError };
  }

  const result = await upgradePlan({
    memberTicketId: parsed.data.memberTicketId,
    newPlanId: parsed.data.newPlanId,
    paidAmount: parsed.data.paidAmount,
    paymentMode: parsed.data.paymentMode,
    prorationMode: parsed.data.prorationMode,
    upiReference: parsed.data.upiReference,
    collectedById: parseInt(session.user.id, 10),
  });

  if (result.success) {
    // We need the userId to revalidate the member page.
    const ticket = await prisma.memberTicket.findUnique({
      where: { id: result.newTicketId },
      select: { userId: true },
    });
    if (ticket) {
      revalidatePath(`/admin/members/${ticket.userId}`);
    }
    revalidatePath("/admin/renewals");
    revalidateTag("members", "max");
    revalidateTag("payments", "max");
    revalidateTag("dashboard", "max");
    revalidateTag("sidebar-counts", "max");
  }

  return result;
}

export async function previewUpgradeAction(data: {
  memberTicketId: number;
  newPlanId: number;
  prorationMode?: "daily" | "monthly" | "none";
}) {
  try {
    await requireWorker();
  } catch {
    return { ok: false as const, error: "Unauthorized" };
  }

  const schema = z.object({
    memberTicketId: z.number().int().positive(),
    newPlanId: z.number().int().positive(),
    prorationMode: z.enum(["daily", "monthly", "none"]).optional(),
  });
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return { ok: false as const, error: "Invalid preview request" };
  }

  return previewUpgrade(parsed.data);
}

export async function getActivePlansForUpgrade() {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  const plans = await prisma.ticketPlan.findMany({
    where: { isActive: true },
    orderBy: [{ price: "asc" }, { name: "asc" }],
    select: { id: true, name: true, price: true, expireDays: true },
  });
  return plans.map((p) => ({ ...p, price: Number(p.price) }));
}
