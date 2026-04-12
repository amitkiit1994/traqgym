import { prisma } from "@/lib/prisma";

const STUB_MODE = !process.env.RAZORPAY_KEY_ID;

export async function createOrder(data: {
  amount: number;
  userId: number;
  ticketId?: number;
}) {
  if (STUB_MODE) {
    console.log(`[Razorpay STUB] createOrder amount=${data.amount}`);
    return {
      success: true,
      orderId: "stub_" + Date.now(),
      amount: data.amount,
    };
  }

  // TODO: Implement real Razorpay order creation using RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET
  return {
    success: true,
    orderId: "stub_" + Date.now(),
    amount: data.amount,
  };
}

export async function verifyPayment(data: {
  orderId: string;
  paymentId: string;
  signature: string;
}) {
  if (STUB_MODE) {
    console.log(`[Razorpay STUB] verifyPayment orderId=${data.orderId}`);
    return { verified: true };
  }

  // TODO: Implement real Razorpay signature verification
  return { verified: true };
}

export async function getOnlinePayments(locationId?: number) {
  try {
    const where: Record<string, unknown> = {
      razorpayPaymentId: { not: null },
    };
    if (locationId) where.locationId = locationId;

    const payments = await prisma.payment.findMany({
      where,
      include: {
        user: { select: { firstname: true, lastname: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return payments.map((p) => ({
      id: p.id,
      userId: p.userId,
      memberName: `${p.user.firstname} ${p.user.lastname}`,
      amount: Number(p.amount),
      razorpayOrderId: p.razorpayOrderId,
      razorpayPaymentId: p.razorpayPaymentId,
      paymentMode: p.paymentMode,
      createdAt: p.createdAt.toISOString(),
    }));
  } catch {
    return [];
  }
}
