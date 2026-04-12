"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import { planSchema, zodErrors } from "@/lib/validations";

export async function getPlans() {
  try { await requireWorker(); } catch { return []; }
  const plans = await prisma.ticketPlan.findMany({
    orderBy: { id: "asc" },
  });
  return plans.map((p) => ({
    ...p,
    price: Number(p.price),
  }));
}

export async function createPlan(data: {
  name: string;
  expireDays: number;
  price: number;
  occasions?: number | null;
}) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = planSchema.safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  await prisma.ticketPlan.create({
    data: {
      name: data.name.trim(),
      expireDays: data.expireDays,
      price: data.price,
      occasions: data.occasions || null,
    },
  });
  revalidatePath("/plans");
  revalidateTag("dashboard", "max");
  return { success: true };
}

export async function updatePlan(
  id: number,
  data: {
    name: string;
    expireDays: number;
    price: number;
    occasions?: number | null;
  }
) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = planSchema.safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  await prisma.ticketPlan.update({
    where: { id },
    data: {
      name: data.name.trim(),
      expireDays: data.expireDays,
      price: data.price,
      occasions: data.occasions || null,
    },
  });
  revalidatePath("/plans");
  revalidateTag("dashboard", "max");
  return { success: true };
}

export async function togglePlanActive(id: number) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const plan = await prisma.ticketPlan.findUnique({ where: { id } });
  if (!plan) return { errors: { _form: "Plan not found" } };

  await prisma.ticketPlan.update({
    where: { id },
    data: { isActive: !plan.isActive },
  });
  revalidatePath("/plans");
  revalidateTag("dashboard", "max");
  return { success: true };
}
