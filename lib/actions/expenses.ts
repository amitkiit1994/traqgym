"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireWorker } from "@/lib/auth-guard";
import { expenseSchema, zodErrors } from "@/lib/validations";
import { createAuditLog } from "@/lib/utils/audit";

export async function getExpenses(month?: string, locationId?: number, category?: string) {
  try { await requireWorker(); } catch { return []; }
  const where: Record<string, unknown> = {};

  if (month) {
    const [year, mon] = month.split("-").map(Number);
    const start = new Date(year, mon - 1, 1);
    const end = new Date(year, mon, 1);
    where.expenseDate = { gte: start, lt: end };
  }

  if (locationId) {
    where.locationId = locationId;
  }

  if (category) {
    where.category = category;
  }

  const expenses = await prisma.expense.findMany({
    where,
    include: { location: { select: { name: true } } },
    orderBy: { expenseDate: "desc" },
  });

  return expenses.map((e) => ({
    id: e.id,
    category: e.category,
    description: e.description,
    amount: Number(e.amount),
    expenseDate: e.expenseDate.toISOString(),
    locationId: e.locationId,
    locationName: e.location?.name ?? "-",
    paidBy: e.paidBy,
    receipt: e.receipt,
    recordedBy: e.recordedBy,
    createdAt: e.createdAt.toISOString(),
  }));
}

export async function createExpense(data: {
  category: string;
  description: string;
  amount: number;
  expenseDate: string;
  locationId?: number;
  paidBy?: string;
  receipt?: string;
}) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = expenseSchema.safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  await prisma.$transaction(async (tx) => {
    await tx.expense.create({
      data: {
        category: data.category,
        description: data.description.trim(),
        amount: data.amount,
        expenseDate: new Date(data.expenseDate),
        locationId: data.locationId || null,
        paidBy: data.paidBy || null,
        receipt: data.receipt?.trim() || null,
      },
    });
    await createAuditLog(tx, "expense_created", JSON.stringify({ category: data.category, amount: data.amount }));
  });

  revalidatePath("/admin/expenses");
  return { success: true };
}

export async function updateExpense(
  id: number,
  data: {
    category: string;
    description: string;
    amount: number;
    expenseDate: string;
    locationId?: number;
    paidBy?: string;
    receipt?: string;
  }
) {
  try { await requireWorker(); } catch { return { error: "Unauthorized" }; }
  const parsed = expenseSchema.safeParse(data);
  if (!parsed.success) return { errors: zodErrors(parsed.error) };

  await prisma.$transaction(async (tx) => {
    await tx.expense.update({
      where: { id },
      data: {
        category: data.category,
        description: data.description.trim(),
        amount: data.amount,
        expenseDate: new Date(data.expenseDate),
        locationId: data.locationId || null,
        paidBy: data.paidBy || null,
        receipt: data.receipt?.trim() || null,
      },
    });
    await createAuditLog(tx, "expense_updated", JSON.stringify({ expenseId: id, category: data.category, amount: data.amount }));
  });

  revalidatePath("/admin/expenses");
  return { success: true };
}

export async function getExpenseSummary(month: string, locationId?: number) {
  try { await requireWorker(); } catch { return { total: 0, byCategory: [] }; }
  const [year, mon] = month.split("-").map(Number);
  const start = new Date(year, mon - 1, 1);
  const end = new Date(year, mon, 1);

  const where: Record<string, unknown> = {
    expenseDate: { gte: start, lt: end },
  };
  if (locationId) where.locationId = locationId;

  const expenses = await prisma.expense.groupBy({
    by: ["category"],
    where,
    _sum: { amount: true },
  });

  const totalResult = await prisma.expense.aggregate({
    where,
    _sum: { amount: true },
  });

  return {
    total: totalResult._sum.amount ? Number(totalResult._sum.amount) : 0,
    byCategory: expenses.map((e) => ({
      category: e.category,
      total: e._sum.amount ? Number(e._sum.amount) : 0,
    })),
  };
}
