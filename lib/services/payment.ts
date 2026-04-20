import { PrismaClient } from "@prisma/client";

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export async function recordPayment(
  tx: TxClient,
  params: {
    userId: number;
    memberTicketId: number;
    locationId: number;
    amount: number;
    paymentMode: string;
    upiReference?: string;
    collectedById: number;
    oldExpiryDate?: Date | null;
    newExpiryDate: Date;
  }
) {
  const payment = await tx.payment.create({
    data: {
      userId: params.userId,
      memberTicketId: params.memberTicketId,
      locationId: params.locationId,
      amount: params.amount,
      paymentMode: params.paymentMode,
      upiReference: params.upiReference ?? null,
      collectedById: params.collectedById,
      oldExpiryDate: params.oldExpiryDate ?? null,
      newExpiryDate: params.newExpiryDate,
    },
  });

  // Auto-tag cash payments to the open cash shift (if any) for this location
  // so closeShift's variance computation can attribute drawer cash correctly.
  // Other payment modes (card/upi/bank/etc.) never enter the drawer, so we
  // skip tagging for them. Use the tx-client (NOT the helper from
  // cash-shift.ts which uses the global prisma) to keep the lookup under the
  // same snapshot as the insert.
  if (params.paymentMode === "cash") {
    const openShift = await tx.cashShift.findFirst({
      where: { locationId: params.locationId, status: "open" },
    });
    if (openShift) {
      return tx.payment.update({
        where: { id: payment.id },
        data: { shiftId: openShift.id },
      });
    }
  }

  return payment;
}
