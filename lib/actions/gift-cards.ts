"use server";

import { requireWorker } from "@/lib/auth-guard";
import {
  createGiftCard as createGiftCardService,
  redeemGiftCard as redeemGiftCardService,
  checkBalance as checkBalanceService,
  getGiftCards as getGiftCardsService,
} from "@/lib/services/gift-cards";

export async function createGiftCard(data: {
  amount: number;
  recipientName?: string;
  recipientPhone?: string;
  purchaserId?: number;
  expiresAt?: string;
}) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  return createGiftCardService(data);
}

export async function redeemGiftCard(code: string, amount: number) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  return redeemGiftCardService(code, amount);
}

export async function checkBalance(code: string) {
  try { await requireWorker(); } catch { return { success: false, error: "Unauthorized" }; }
  return checkBalanceService(code);
}

export async function getGiftCards(status?: string) {
  try { await requireWorker(); } catch { return []; }
  return getGiftCardsService(status);
}
