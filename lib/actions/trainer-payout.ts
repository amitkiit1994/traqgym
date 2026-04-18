"use server";

import { z } from "zod";
import { requireWorker } from "@/lib/auth-guard";
import {
  computeMonthlyPayout,
  markPayoutPaid,
  listPendingPayouts,
  listPayoutsForTrainer,
} from "@/lib/services/trainer-payout";

const computeSchema = z.object({
  trainerId: z.number().int().positive(),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
});

export async function computeMonthlyPayoutAction(input: {
  trainerId: number;
  month: number;
  year: number;
}) {
  try {
    await requireWorker(["admin"]);
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }
  const parsed = computeSchema.safeParse(input);
  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { success: false as const, error: firstError ?? "Invalid input" };
  }
  return computeMonthlyPayout(input.trainerId, input.month, input.year);
}

const markPaidSchema = z.object({
  payoutId: z.number().int().positive(),
  paymentMode: z.string().min(1),
  paidAt: z.string().optional(),
});

export async function markPayoutPaidAction(input: {
  payoutId: number;
  paymentMode: string;
  paidAt?: string;
}) {
  let session;
  try {
    session = await requireWorker(["admin"]);
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }
  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) {
    const firstError = Object.values(parsed.error.flatten().fieldErrors)[0]?.[0];
    return { success: false as const, error: firstError ?? "Invalid input" };
  }
  const paidAt = input.paidAt ? new Date(input.paidAt) : undefined;
  if (paidAt && isNaN(paidAt.getTime())) {
    return { success: false as const, error: "Invalid paidAt" };
  }
  return markPayoutPaid({
    payoutId: input.payoutId,
    paymentMode: input.paymentMode,
    paidAt,
    markedById: parseInt(session.user.id, 10),
  });
}

export async function listPendingPayoutsAction(opts?: { trainerId?: number }) {
  try {
    await requireWorker(["admin"]);
  } catch {
    return [];
  }
  return listPendingPayouts(opts);
}

export async function listPayoutsForTrainerAction(trainerId: number) {
  try {
    await requireWorker();
  } catch {
    return [];
  }
  return listPayoutsForTrainer(trainerId);
}
