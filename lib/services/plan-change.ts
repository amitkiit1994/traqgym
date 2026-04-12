import { prisma } from "@/lib/prisma";
import { todayIST } from "@/lib/utils/date";
import { recordPayment } from "./payment";
import { generateInvoice } from "./invoice";
import { sendPaymentNotification } from "./payment-notification";

export async function upgradePlan(params: {
  userId: number;
  currentTicketId: number;
  newPlanId: number;
  locationId: number;
  paymentMode: string;
  upiRef?: string;
  collectedById: number;
}) {
  const user = await prisma.user.findUnique({ where: { id: params.userId } });
  if (!user) return { success: false, error: "User not found" };

  const currentTicket = await prisma.memberTicket.findUnique({
    where: { id: params.currentTicketId },
    include: { plan: true },
  });
  if (!currentTicket) return { success: false, error: "Current ticket not found" };

  const newPlan = await prisma.ticketPlan.findUnique({ where: { id: params.newPlanId } });
  if (!newPlan) return { success: false, error: "New plan not found" };
  if (!newPlan.isActive) return { success: false, error: "New plan is not active" };

  const today = todayIST();

  const expireDate = new Date(currentTicket.expireDate);
  expireDate.setHours(0, 0, 0, 0);
  const buyDate = new Date(currentTicket.buyDate);
  buyDate.setHours(0, 0, 0, 0);

  const totalDays = Math.max(1, Math.ceil((expireDate.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24)));
  const remainingDays = Math.max(0, Math.ceil((expireDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

  const oldPrice = Number(currentTicket.plan.price);
  const credit = (remainingDays / totalDays) * oldPrice;
  const newPlanPrice = Number(newPlan.price);
  const roundedCredit = Math.round(credit);
  if (roundedCredit > newPlanPrice) {
    return {
      success: false,
      error: `Credit (₹${roundedCredit}) exceeds new plan price (₹${newPlanPrice}). Downgrade not supported — please contact admin.`,
    };
  }

  const amountDue = Math.max(0, Math.round(newPlanPrice - credit));

  // New expiry from today + newPlan.expireDays
  const newExpiryDate = new Date(today);
  newExpiryDate.setDate(newExpiryDate.getDate() + newPlan.expireDays);

  const result = await prisma.$transaction(async (tx) => {
    const memberTicket = await tx.memberTicket.create({
      data: {
        userId: params.userId,
        planId: params.newPlanId,
        locationId: params.locationId,
        buyDate: new Date(),
        expireDate: newExpiryDate,
        occasions: newPlan.occasions,
      },
    });

    const payment = await recordPayment(tx, {
      userId: params.userId,
      memberTicketId: memberTicket.id,
      locationId: params.locationId,
      amount: amountDue,
      paymentMode: params.paymentMode,
      upiReference: params.upiRef,
      collectedById: params.collectedById,
      oldExpiryDate: currentTicket.expireDate,
      newExpiryDate,
    });

    const invoice = await generateInvoice(tx, {
      userId: params.userId,
      paymentId: payment.id,
    });

    await tx.auditLog.create({
      data: {
        action: "plan_change",
        status: "success",
        details: JSON.stringify({
          userId: params.userId,
          oldPlan: currentTicket.plan.name,
          newPlan: newPlan.name,
          credit: Math.round(credit),
          amountDue,
          oldExpiryDate: currentTicket.expireDate.toISOString(),
          newExpiryDate: newExpiryDate.toISOString(),
          invoiceNumber: invoice.invoiceNumber,
        }),
        actorId: params.collectedById,
        actorType: "worker",
      },
    });

    return { payment, invoice, memberTicket };
  });

  // Post-upgrade notification (non-blocking)
  try {
    await sendPaymentNotification({
      userId: params.userId,
      phone: user.phone,
      emailAddress: user.email,
      memberName: `${user.firstname} ${user.lastname}`,
      planName: newPlan.name,
      amount: amountDue,
      newExpiryDate,
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoiceNumber,
      action: "plan_change",
    });
  } catch (err) {
    console.error("[PlanChange] Notification failed (non-blocking):", err);
  }

  return {
    success: true,
    paymentId: result.payment.id,
    invoiceNumber: result.invoice.invoiceNumber,
    newExpiryDate,
    credit: Math.round(credit),
    amountDue,
  };
}
