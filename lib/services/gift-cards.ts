import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function createGiftCard(data: {
  amount: number;
  recipientName?: string;
  recipientPhone?: string;
  purchaserId?: number;
  expiresAt?: string;
}) {
  try {
    // Generate unique code with retry
    let code = generateCode();
    let attempts = 0;
    while (attempts < 5) {
      const existing = await prisma.giftCard.findUnique({ where: { code } });
      if (!existing) break;
      code = generateCode();
      attempts++;
    }

    const card = await prisma.giftCard.create({
      data: {
        code,
        amount: data.amount,
        balance: data.amount,
        purchaserId: data.purchaserId ?? null,
        recipientName: data.recipientName?.trim() ?? null,
        recipientPhone: data.recipientPhone?.trim() ?? null,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });

    return {
      success: true,
      card: {
        id: card.id,
        code: card.code,
        amount: Number(card.amount),
        balance: Number(card.balance),
        recipientName: card.recipientName,
        recipientPhone: card.recipientPhone,
        status: card.status,
        expiresAt: card.expiresAt?.toISOString() ?? null,
        createdAt: card.createdAt.toISOString(),
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to create gift card" };
  }
}

export async function redeemGiftCard(code: string, amount: number) {
  try {
    // Decimal math throughout so successive redemptions don't drift via IEEE-754
    // (the "zombie card" bug in tests/bugs/financial-bugs.test.ts BUG 3).
    const amountDec = new Prisma.Decimal(amount);

    const card = await prisma.giftCard.findUnique({ where: { code } });
    if (!card) return { success: false, error: "Gift card not found" };
    if (card.status !== "active") return { success: false, error: `Gift card is ${card.status}` };
    if (card.expiresAt && card.expiresAt < new Date()) return { success: false, error: "Gift card has expired" };
    const balanceDec = new Prisma.Decimal(card.balance);
    if (amountDec.gt(balanceDec)) {
      return { success: false, error: `Insufficient balance. Available: ₹${balanceDec.toFixed(2)}` };
    }

    // Atomic update with balance check to prevent race conditions
    const result = await prisma.$transaction(async (tx) => {
      // Re-read inside transaction for consistency
      const current = await tx.giftCard.findUnique({ where: { code } });
      if (!current) throw new Error("Insufficient balance");
      const currentBalanceDec = new Prisma.Decimal(current.balance);
      if (currentBalanceDec.lt(amountDec)) {
        throw new Error("Insufficient balance");
      }

      const newBalance = currentBalanceDec.minus(amountDec);
      // Exact Decimal comparison — no epsilon needed since math is precise.
      const newStatus = newBalance.lte(0) ? "redeemed" : "active";

      return tx.giftCard.update({
        where: { code },
        data: { balance: newBalance, status: newStatus },
      });
    });

    return { success: true, remaining: new Prisma.Decimal(result.balance).toNumber(), status: result.status };
  } catch (err) {
    if (err instanceof Error && err.message === "Insufficient balance") {
      return { success: false, error: "Insufficient balance (concurrent redemption)" };
    }
    return { success: false, error: err instanceof Error ? err.message : "Failed to redeem gift card" };
  }
}

export async function checkBalance(code: string) {
  try {
    const card = await prisma.giftCard.findUnique({ where: { code } });
    if (!card) return { success: false, error: "Gift card not found" };

    return {
      success: true,
      card: {
        id: card.id,
        code: card.code,
        amount: Number(card.amount),
        balance: Number(card.balance),
        status: card.status,
        recipientName: card.recipientName,
        recipientPhone: card.recipientPhone,
        expiresAt: card.expiresAt?.toISOString() ?? null,
        createdAt: card.createdAt.toISOString(),
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to check balance" };
  }
}

export async function getGiftCards(status?: string) {
  try {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const cards = await prisma.giftCard.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return cards.map((c) => ({
      id: c.id,
      code: c.code,
      amount: Number(c.amount),
      balance: Number(c.balance),
      status: c.status,
      recipientName: c.recipientName,
      recipientPhone: c.recipientPhone,
      purchaserId: c.purchaserId,
      expiresAt: c.expiresAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}
