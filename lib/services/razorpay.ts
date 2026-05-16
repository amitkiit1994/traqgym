import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/services/settings";
import { ConfigurationError, NotEnabledError } from "@/lib/services/errors";

/**
 * Razorpay integration. Online payment is OFF by default for new gyms.
 *
 * To enable for a gym:
 *   1. Set RAZORPAY_KEY_ID env var in Vercel (the public key id)
 *   2. Set razorpay_key_secret in GymSettings (the secret, auto-encrypted by settings service)
 *
 * If either is missing, createOrder/verifyPayment throw — they will NEVER silently
 * mock responses. UI should call isOnlinePaymentEnabled() before showing online-payment
 * flows.
 */

async function loadRazorpayConfig(): Promise<{ keyId: string; keySecret: string }> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId) {
    throw new ConfigurationError(
      "RAZORPAY_KEY_ID",
      "Razorpay is not configured: RAZORPAY_KEY_ID env var is unset. Set it in Vercel project settings to enable online payments."
    );
  }
  const keySecret = await getSetting("razorpay_key_secret", "");
  if (!keySecret) {
    throw new NotEnabledError(
      "razorpay",
      "Razorpay is not enabled for this gym: razorpay_key_secret missing from GymSettings. Configure via /admin/settings/integrations/razorpay."
    );
  }
  return { keyId, keySecret };
}

export async function createOrder(data: {
  amount: number;
  userId: number;
  ticketId?: number;
}): Promise<{ success: true; orderId: string; amount: number }> {
  const { keyId, keySecret } = await loadRazorpayConfig();

  // Razorpay Orders API: POST https://api.razorpay.com/v1/orders
  // Auth: Basic base64(keyId:keySecret)
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: Math.round(data.amount * 100), // Razorpay uses paise (integer)
      currency: "INR",
      receipt: `tg_${data.userId}_${data.ticketId ?? "x"}_${Date.now()}`,
      notes: {
        userId: String(data.userId),
        ...(data.ticketId ? { ticketId: String(data.ticketId) } : {}),
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Razorpay createOrder failed: HTTP ${res.status} ${errText}`);
  }

  const order = (await res.json()) as { id: string; amount: number; currency: string };
  return { success: true, orderId: order.id, amount: order.amount / 100 };
}

export async function verifyPayment(data: {
  orderId: string;
  paymentId: string;
  signature: string;
}): Promise<{ verified: boolean }> {
  const { keySecret } = await loadRazorpayConfig();

  // Verify HMAC-SHA256(orderId + "|" + paymentId, secret) === signature
  const crypto = await import("node:crypto");
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${data.orderId}|${data.paymentId}`)
    .digest("hex");

  // Timing-safe compare
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(data.signature, "hex");
  if (expectedBuf.length !== providedBuf.length) {
    return { verified: false };
  }
  const verified = crypto.timingSafeEqual(expectedBuf, providedBuf);
  return { verified };
}

export async function getOnlinePayments(locationId?: number) {
  try {
    const where: Record<string, unknown> = {
      razorpayPaymentId: { not: null },
      userId: { not: null },
    };
    if (locationId) where.locationId = locationId;

    const payments = await prisma.payment.findMany({
      where,
      include: {
        user: { select: { firstname: true, lastname: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return payments
      .filter((p) => p.user !== null)
      .map((p) => ({
        id: p.id,
        userId: p.userId,
        memberName: `${p.user!.firstname} ${p.user!.lastname}`,
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
