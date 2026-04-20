import { prisma } from "@/lib/prisma";
import { recordPayment } from "./payment";
import { generateInvoice } from "./invoice";
import { sendPaymentNotification } from "./payment-notification";
import { computeGstSplitInclusive, getGymGstRate } from "./tax";
import { todayIST } from "@/lib/utils/date";
import { withSerializableRetry } from "@/lib/utils/serializable";

export async function renewMembership(params: {
  userId: number;
  planId: number;
  locationId: number;
  paymentMode: string;
  upiReference?: string;
  collectedById: number;
  promoCode?: string;
  /**
   * H3: optional partial-payment amount. When omitted, the member pays the full
   * computed total (post-discount + joining fee). When supplied and less than
   * the total, the MemberTicket is created with balanceDue = total - amountPaid
   * and the Payment row is flagged paymentStatus="partial". The ticket itself
   * still becomes active so the member can use the gym immediately.
   */
  amountPaid?: number;
}) {
  // 1. Validate user exists
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) throw new Error("User not found");

  // 2. Validate plan exists + isActive
  const plan = await prisma.ticketPlan.findUnique({ where: { id: params.planId } });
  if (!plan) throw new Error("Plan not found");
  if (!plan.isActive) throw new Error("Plan is not active");

  // 3. Validate location exists + isActive
  const location = await prisma.location.findUnique({ where: { id: params.locationId } });
  if (!location) throw new Error("Location not found");
  if (!location.isActive) throw new Error("Location is not active");

  // 3b. Validate worker exists + isActive
  const worker = await prisma.worker.findUnique({ where: { id: params.collectedById } });
  if (!worker) throw new Error("Worker not found");
  if (!worker.isActive) throw new Error("Worker account is not active");

  // 4. Idempotency check runs INSIDE the $transaction below (see step 7) under
  //    SERIALIZABLE isolation via withSerializableRetry. Two concurrent
  //    renewals can no longer both miss each other's pending insert: the
  //    second commit gets a 40001 serialization failure and the helper
  //    retries against a snapshot that now sees the first row, returning
  //    the duplicatePayment branch. Closes the residual READ COMMITTED race.

  // 5. Get latest expiry
  const latestTicket = await prisma.memberTicket.findFirst({
    where: { userId: params.userId },
    orderBy: { expireDate: "desc" },
  });

  // 6. Calculate new expiry
  const today = todayIST();
  let baseDate: Date;
  const oldExpiryDate = latestTicket?.expireDate ?? null;

  if (latestTicket && latestTicket.expireDate > today) {
    // Active membership: extend from current expiry
    baseDate = latestTicket.expireDate;
  } else {
    // Expired or no membership: start fresh from today
    baseDate = today;
  }

  const newExpiryDate = new Date(baseDate);
  newExpiryDate.setDate(newExpiryDate.getDate() + plan.expireDays);

  // 6b. Promo code quick-fail check (authoritative check inside transaction)
  if (params.promoCode) {
    const promo = await prisma.promoCode.findUnique({
      where: { code: params.promoCode.trim().toUpperCase() },
    });
    if (!promo) throw new Error("Invalid promo code");
    if (!promo.isActive) throw new Error("Promo code is inactive");
  }

  // 6c. Joining-fee policy values (per-plan). The actual prior-ticket count
  // read happens INSIDE the transaction below to avoid a double-charge race
  // where two concurrent first-time renewals each see priorTicketCount === 0.
  const planJoiningFee = Number(plan.joiningFee ?? 0);
  const appliesOn = plan.joiningFeeAppliesOn ?? "first_only";

  // 6d. Resolve gym GST rate ONCE outside the txn — the setting is read-mostly
  // and we don't want to refetch under SERIALIZABLE for every retry. Used to
  // populate Payment.{baseAmount,taxRate,taxAmount} so Tally + GSTR-1 exports
  // emit a real tax breakdown instead of silently zero-ing.
  const gymGstRate = await getGymGstRate();

  // 7. Prisma $transaction under SERIALIZABLE isolation w/ retry
  const result = await withSerializableRetry(async (tx) => {
    // Idempotency check INSIDE the txn: same userId+planId+paymentMode+
    // collectedById in last 60 seconds. Running this under the txn snapshot
    // closes the race where two concurrent calls both pass an outside-txn
    // check and both insert.
    const sixtySecondsAgo = new Date(Date.now() - 60_000);
    const duplicatePayment = await tx.payment.findFirst({
      where: {
        userId: params.userId,
        paymentMode: params.paymentMode,
        collectedById: params.collectedById,
        createdAt: { gte: sixtySecondsAgo },
        memberTicket: { planId: params.planId },
      },
      include: {
        invoice: true,
        memberTicket: true,
      },
    });
    if (duplicatePayment) {
      return {
        idempotent: true as const,
        duplicatePayment,
      };
    }

    // Determine joining fee for this purchase using a TXN-fresh prior count.
    let joiningFeeCharged = 0;
    if (planJoiningFee > 0 && appliesOn !== "never") {
      if (appliesOn === "every_renewal") {
        joiningFeeCharged = planJoiningFee;
      } else if (appliesOn === "first_only") {
        const priorTicketCount = await tx.memberTicket.count({
          where: { userId: params.userId },
        });
        if (priorTicketCount === 0) {
          joiningFeeCharged = planJoiningFee;
        }
      }
    }

    // Promo code validation and discount calculation inside transaction
    let finalAmount = Number(plan.price);
    let discountApplied = 0;
    if (params.promoCode) {
      const promo = await tx.promoCode.findUnique({
        where: { code: params.promoCode.trim().toUpperCase() },
      });
      if (!promo) throw new Error("Invalid promo code");
      if (!promo.isActive) throw new Error("Promo code is inactive");

      const nowDate = todayIST();
      if (nowDate < promo.validFrom || nowDate > promo.validTo)
        throw new Error("Promo code has expired");
      if (promo.maxUses && promo.usedCount >= promo.maxUses)
        throw new Error("Promo code usage limit reached");
      if (promo.planIds) {
        const allowedIds = promo.planIds.split(",").map((s) => parseInt(s.trim(), 10));
        if (!allowedIds.includes(params.planId))
          throw new Error("Promo code not valid for this plan");
      }

      if (promo.discountType === "percentage") {
        discountApplied = Math.round((finalAmount * Number(promo.discountValue)) / 100);
      } else {
        discountApplied = Number(promo.discountValue);
      }
      discountApplied = Math.min(discountApplied, finalAmount);
      finalAmount = finalAmount - discountApplied;
    }

    // Add joining fee on top of (post-discount) plan price
    finalAmount = finalAmount + joiningFeeCharged;

    // H3: derive partial-pay amounts. amountPaid defaults to the full total.
    // Negative or > total values are clamped to keep the invariant that
    // amountPaid + balanceDue === totalAmount.
    const requestedPaid =
      typeof params.amountPaid === "number" && Number.isFinite(params.amountPaid)
        ? params.amountPaid
        : finalAmount;
    const amountPaidForTicket = Math.max(0, Math.min(requestedPaid, finalAmount));
    const balanceDue = Math.max(0, finalAmount - amountPaidForTicket);
    const isPartial = balanceDue > 0;

    // CREATE MemberTicket — keep status "active" even when partial so the
    // member retains gym access; balanceDue carries the unpaid remainder.
    const memberTicket = await tx.memberTicket.create({
      data: {
        userId: params.userId,
        planId: params.planId,
        locationId: params.locationId,
        buyDate: new Date(),
        expireDate: newExpiryDate,
        occasions: plan.occasions,
        totalAmount: finalAmount,
        amountPaid: amountPaidForTicket,
        balanceDue,
        joiningFeeCharged,
      },
    });

    // CREATE Payment — record the actual amount paid (not the plan total) so
    // cash-shift / revenue reports reflect collected money. Mark status partial
    // when there's a remaining balance.
    const payment = await recordPayment(tx, {
      userId: params.userId,
      memberTicketId: memberTicket.id,
      locationId: params.locationId,
      amount: amountPaidForTicket,
      paymentMode: params.paymentMode,
      upiReference: params.upiReference,
      collectedById: params.collectedById,
      oldExpiryDate,
      newExpiryDate,
    });
    // recordPayment lives in a sibling-owned file and does not accept GST or
    // paymentStatus fields — patch them in here so Tally / GSTR-1 exports see
    // a real tax breakdown and balance-due reports pick up the unpaid remainder.
    const gstSplit = computeGstSplitInclusive(amountPaidForTicket, gymGstRate);
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        baseAmount: gstSplit.baseAmount,
        taxRate: gstSplit.taxRate,
        taxAmount: gstSplit.taxAmount,
        ...(isPartial ? { paymentStatus: "partial" } : {}),
      },
    });

    // CREATE Invoice
    const invoice = await generateInvoice(tx, {
      userId: params.userId,
      paymentId: payment.id,
    });

    // CREATE AuditLog
    await tx.auditLog.create({
      data: {
        action: "renewal",
        status: "success",
        details: JSON.stringify({
          userId: params.userId,
          planId: params.planId,
          planName: plan.name,
          amount: finalAmount,
          amountPaid: amountPaidForTicket,
          balanceDue,
          isPartial,
          discount: discountApplied,
          joiningFee: joiningFeeCharged,
          promoCode: params.promoCode || null,
          paymentMode: params.paymentMode,
          oldExpiryDate: oldExpiryDate?.toISOString() ?? null,
          newExpiryDate: newExpiryDate.toISOString(),
          invoiceNumber: invoice.invoiceNumber,
        }),
        actorId: params.collectedById,
        actorType: "worker",
      },
    });

    // Increment promo code usage inside transaction
    if (params.promoCode) {
      await tx.promoCode.update({
        where: { code: params.promoCode.trim().toUpperCase() },
        data: { usedCount: { increment: 1 } },
      });
    }

    return { idempotent: false as const, payment, invoice, memberTicket, finalAmount };
  });

  // Idempotent short-circuit: skip notifications and return the prior result.
  if (result.idempotent) {
    return {
      success: true,
      idempotent: true,
      paymentId: result.duplicatePayment.id,
      invoiceNumber: result.duplicatePayment.invoice?.invoiceNumber ?? null,
      newExpiryDate: result.duplicatePayment.newExpiryDate,
    };
  }

  // 8. Post-renewal notification (non-blocking — never fails the renewal)
  try {
    await sendPaymentNotification({
      userId: params.userId,
      phone: user.phone,
      emailAddress: user.email,
      memberName: `${user.firstname} ${user.lastname}`,
      planName: plan.name,
      amount: result.finalAmount,
      newExpiryDate,
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoiceNumber,
      action: "renewal",
    });
  } catch (err) {
    console.error("[Renewal] Notification failed (non-blocking):", err);
  }

  // 8b. In-app notifications (fire-and-forget)
  try {
    const { notifyUser, notifyWorkersByRole } = await import("@/lib/services/in-app-notification");
    const memberName = `${user.firstname} ${user.lastname}`;

    // Notify member of payment received
    await notifyUser({
      userId: params.userId,
      type: "payment_received",
      title: `Payment of ₹${result.finalAmount.toLocaleString("en-IN")} received`,
      message: `${plan.name} — valid until ${newExpiryDate.toLocaleDateString("en-IN")}`,
      link: "/member/invoices",
    });

    // If first-time member (no prior ticket), notify admins
    if (!latestTicket) {
      await notifyWorkersByRole({
        role: "admin",
        type: "new_member",
        title: `New member: ${memberName}`,
        message: `Joined with ${plan.name}`,
        link: "/admin/members",
      });
    }
  } catch {}

  // 9. Return result
  return {
    success: true,
    idempotent: false,
    paymentId: result.payment.id,
    invoiceNumber: result.invoice.invoiceNumber,
    newExpiryDate,
  };
}
