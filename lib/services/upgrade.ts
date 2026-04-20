import { prisma } from "@/lib/prisma";
import { recordPayment } from "./payment";
import { generateInvoice } from "./invoice";
import { getSetting } from "./settings";
import { todayIST } from "@/lib/utils/date";

export type UpgradePlanResult =
  | { success: true; newTicketId: number; creditApplied: number; amountCharged: number; invoiceNumber: string }
  | { success: false; error: string };

type ProrationMode = "daily" | "monthly" | "none";

function isProrationMode(v: string): v is ProrationMode {
  return v === "daily" || v === "monthly" || v === "none";
}

/**
 * Atomically upgrade a member's plan mid-cycle.
 *
 * - Marks the current MemberTicket as status="upgraded".
 * - Creates a new MemberTicket on the new plan.
 * - Computes a proration credit from the remaining time on the old ticket.
 * - Records the additional Payment collected (the diff after credit).
 * - Generates an Invoice for the upgrade payment.
 * - Writes an AuditLog with both ticket IDs.
 *
 * The caller (UI/action) is responsible for telling us how much was collected.
 * The credit applied is computed here; the caller can show it as a preview.
 */
export async function upgradePlan(params: {
  memberTicketId: number;
  newPlanId: number;
  paidAmount: number; // additional amount collected (could be 0 if upgrade has credit)
  paymentMode: string;
  collectedById: number;
  prorationMode?: ProrationMode; // default from setting upgrade_proration_mode
  upiReference?: string;
}): Promise<UpgradePlanResult> {
  // Resolve default proration mode from settings if not explicitly given.
  let prorationMode: ProrationMode = params.prorationMode ?? "daily";
  if (!params.prorationMode) {
    const setting = await getSetting("upgrade_proration_mode", "daily");
    if (isProrationMode(setting)) prorationMode = setting;
  }

  const currentTicket = await prisma.memberTicket.findUnique({
    where: { id: params.memberTicketId },
    include: { plan: true, user: true },
  });
  if (!currentTicket) return { success: false, error: "Current ticket not found" };
  if (currentTicket.status === "upgraded" || currentTicket.status === "cancelled") {
    return { success: false, error: `Ticket is already ${currentTicket.status}` };
  }

  const newPlan = await prisma.ticketPlan.findUnique({ where: { id: params.newPlanId } });
  if (!newPlan) return { success: false, error: "New plan not found" };
  if (!newPlan.isActive) return { success: false, error: "New plan is not active" };

  if (currentTicket.planId === newPlan.id) {
    return { success: false, error: "Cannot upgrade to the same plan" };
  }

  const worker = await prisma.worker.findUnique({ where: { id: params.collectedById } });
  if (!worker) return { success: false, error: "Worker not found" };
  if (!worker.isActive) return { success: false, error: "Worker account is not active" };

  if (params.paidAmount < 0) return { success: false, error: "paidAmount cannot be negative" };

  // ─── Proration credit ───────────────────────────────────────────────
  const today = todayIST();
  const expireDate = new Date(currentTicket.expireDate);
  expireDate.setHours(0, 0, 0, 0);
  const buyDate = new Date(currentTicket.buyDate);
  buyDate.setHours(0, 0, 0, 0);

  const oldPlanPrice = Number(currentTicket.plan.price);
  const oldPlanDuration = Math.max(1, currentTicket.plan.expireDays);

  let credit = 0;
  if (prorationMode === "daily") {
    const remainingDays = Math.max(
      0,
      Math.ceil((expireDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    );
    credit = (remainingDays / oldPlanDuration) * oldPlanPrice;
  } else if (prorationMode === "monthly") {
    // integer-month based: floor(remainingDays / 30) months credited at monthly rate
    const remainingDays = Math.max(
      0,
      Math.ceil((expireDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    );
    const monthsRemaining = Math.floor(remainingDays / 30);
    const totalMonths = Math.max(1, Math.round(oldPlanDuration / 30));
    credit = (monthsRemaining / totalMonths) * oldPlanPrice;
  } else {
    credit = 0;
  }

  const creditApplied = Math.max(0, Math.round(credit));
  const newPlanPrice = Number(newPlan.price);

  // Sanity: don't allow credit to exceed new plan price (downgrade not supported here)
  if (creditApplied > newPlanPrice) {
    return {
      success: false,
      error: `Credit (₹${creditApplied}) exceeds new plan price (₹${newPlanPrice}). Downgrade not supported through this flow.`,
    };
  }

  // New expiry: today + new plan duration
  const newExpiryDate = new Date(today);
  newExpiryDate.setDate(newExpiryDate.getDate() + newPlan.expireDays);

  const oldTicketId = currentTicket.id;
  const oldExpiryDate = currentTicket.expireDate;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Mark old ticket as upgraded — optimistic-lock against the
      // status we read at line 51. If a concurrent renewal flipped it
      // (e.g. status="renewed"), the conditional update returns count===0
      // and we abort the whole txn to avoid double-billing.
      const claim = await tx.memberTicket.updateMany({
        where: { id: oldTicketId, status: currentTicket.status },
        data: {
          status: "upgraded",
          cancelledAt: new Date(),
        },
      });
      if (claim.count === 0) {
        throw new Error(
          "Ticket state changed concurrently (renewal or another upgrade) — refresh and retry"
        );
      }

      // 2. Create new MemberTicket
      const newTicket = await tx.memberTicket.create({
        data: {
          userId: currentTicket.userId,
          planId: params.newPlanId,
          locationId: currentTicket.locationId,
          buyDate: new Date(),
          expireDate: newExpiryDate,
          occasions: newPlan.occasions,
          totalAmount: newPlanPrice,
          amountPaid: params.paidAmount + creditApplied,
          balanceDue: Math.max(0, newPlanPrice - (params.paidAmount + creditApplied)),
        },
      });

      // 3. Record Payment for the additional amount collected
      const payment = await recordPayment(tx, {
        userId: currentTicket.userId,
        memberTicketId: newTicket.id,
        locationId: currentTicket.locationId ?? 0,
        amount: params.paidAmount,
        paymentMode: params.paymentMode,
        upiReference: params.upiReference,
        collectedById: params.collectedById,
        oldExpiryDate,
        newExpiryDate,
      });

      // 4. Generate Invoice
      const invoice = await generateInvoice(tx, {
        userId: currentTicket.userId,
        paymentId: payment.id,
      });

      // 5. AuditLog with both ticket IDs
      await tx.auditLog.create({
        data: {
          action: "plan_upgrade",
          status: "success",
          details: JSON.stringify({
            userId: currentTicket.userId,
            oldTicketId,
            newTicketId: newTicket.id,
            oldPlanId: currentTicket.planId,
            oldPlanName: currentTicket.plan.name,
            newPlanId: newPlan.id,
            newPlanName: newPlan.name,
            prorationMode,
            creditApplied,
            paidAmount: params.paidAmount,
            newPlanPrice,
            oldExpiryDate: oldExpiryDate.toISOString(),
            newExpiryDate: newExpiryDate.toISOString(),
            invoiceNumber: invoice.invoiceNumber,
          }),
          actorId: params.collectedById,
          actorType: "worker",
        },
      });

      return { newTicket, invoice };
    });

    // Best-effort in-app notification (non-blocking)
    try {
      const { notifyUser } = await import("@/lib/services/in-app-notification");
      await notifyUser({
        userId: currentTicket.userId,
        type: "plan_upgrade",
        title: `Plan upgraded to ${newPlan.name}`,
        message: `Valid until ${newExpiryDate.toLocaleDateString("en-IN")}. Credit applied: ₹${creditApplied.toLocaleString("en-IN")}.`,
        link: "/member/invoices",
      });
    } catch (err) {
      console.error("[Upgrade] In-app notification failed (non-blocking):", err);
    }

    return {
      success: true,
      newTicketId: result.newTicket.id,
      creditApplied,
      amountCharged: params.paidAmount,
      invoiceNumber: result.invoice.invoiceNumber,
    };
  } catch (err) {
    console.error("[Upgrade] Transaction failed:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Upgrade failed",
    };
  }
}

/**
 * Pure preview of upgrade math — does NOT mutate. UI uses this to show
 * the credit / amount-due before the worker confirms.
 */
export async function previewUpgrade(params: {
  memberTicketId: number;
  newPlanId: number;
  prorationMode?: ProrationMode;
}): Promise<
  | { ok: true; creditApplied: number; newPlanPrice: number; suggestedAmountDue: number; newExpiryDate: Date; oldPlanName: string; newPlanName: string }
  | { ok: false; error: string }
> {
  let prorationMode: ProrationMode = params.prorationMode ?? "daily";
  if (!params.prorationMode) {
    const setting = await getSetting("upgrade_proration_mode", "daily");
    if (isProrationMode(setting)) prorationMode = setting;
  }

  const currentTicket = await prisma.memberTicket.findUnique({
    where: { id: params.memberTicketId },
    include: { plan: true },
  });
  if (!currentTicket) return { ok: false, error: "Current ticket not found" };

  const newPlan = await prisma.ticketPlan.findUnique({ where: { id: params.newPlanId } });
  if (!newPlan) return { ok: false, error: "New plan not found" };
  if (!newPlan.isActive) return { ok: false, error: "New plan is not active" };

  const today = todayIST();
  const expireDate = new Date(currentTicket.expireDate);
  expireDate.setHours(0, 0, 0, 0);
  const oldPlanPrice = Number(currentTicket.plan.price);
  const oldPlanDuration = Math.max(1, currentTicket.plan.expireDays);

  let credit = 0;
  const remainingDays = Math.max(
    0,
    Math.ceil((expireDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  );
  if (prorationMode === "daily") {
    credit = (remainingDays / oldPlanDuration) * oldPlanPrice;
  } else if (prorationMode === "monthly") {
    const monthsRemaining = Math.floor(remainingDays / 30);
    const totalMonths = Math.max(1, Math.round(oldPlanDuration / 30));
    credit = (monthsRemaining / totalMonths) * oldPlanPrice;
  }

  const creditApplied = Math.max(0, Math.round(credit));
  const newPlanPrice = Number(newPlan.price);
  const suggestedAmountDue = Math.max(0, Math.round(newPlanPrice - creditApplied));

  const newExpiryDate = new Date(today);
  newExpiryDate.setDate(newExpiryDate.getDate() + newPlan.expireDays);

  return {
    ok: true,
    creditApplied,
    newPlanPrice,
    suggestedAmountDue,
    newExpiryDate,
    oldPlanName: currentTicket.plan.name,
    newPlanName: newPlan.name,
  };
}
