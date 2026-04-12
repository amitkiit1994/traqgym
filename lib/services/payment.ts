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
  return tx.payment.create({
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
}
