"use server";

import { requireWorker } from "@/lib/auth-guard";
import { revalidatePath, revalidateTag } from "next/cache";
import {
  recordPartialPayment,
  getBalanceDueReport,
  getMemberBalance,
} from "@/lib/services/partial-payment";

export async function recordPartialPaymentAction(params: {
  ticketId: number;
  amount: number;
  paymentMode: string;
  upiReference?: string;
}) {
  try {
    const session = await requireWorker();
    const result = await recordPartialPayment({
      ...params,
      collectedById: parseInt(session.user.id, 10),
    });

    if (result.success) {
      revalidatePath("/admin/balance-due");
      revalidateTag("payments", "max");
      revalidateTag("dashboard", "max");
      revalidateTag("sidebar-counts", "max");
    }

    return result;
  } catch {
    return { success: false as const, error: "Unauthorized" };
  }
}

export async function getBalanceDueReportAction(locationId?: number) {
  try { await requireWorker(); } catch { return []; }
  return getBalanceDueReport(locationId);
}

export async function getMemberBalanceAction(userId: number) {
  try { await requireWorker(); } catch { return []; }
  return getMemberBalance(userId);
}
