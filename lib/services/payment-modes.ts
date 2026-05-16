import { getSetting } from "@/lib/services/settings";

const DEFAULT_MODES = ["cash", "upi"] as const;
type DefaultMode = (typeof DEFAULT_MODES)[number];
export type PaymentMode = DefaultMode | "card" | "online";

/**
 * Returns the list of payment modes enabled for this gym.
 * Default: cash + upi (Indian gym default — most still take cash).
 *
 * Configured via setting `payment_modes_enabled` (comma-separated).
 * Example values: "cash", "cash,upi", "cash,upi,card,online".
 */
export async function getEnabledPaymentModes(): Promise<PaymentMode[]> {
  const raw = await getSetting("payment_modes_enabled", DEFAULT_MODES.join(","));
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is PaymentMode => Boolean(s)) as PaymentMode[];
}

/**
 * Online payment (Razorpay) is enabled when:
 *   1. RAZORPAY_KEY_ID env var is set (the public key, can ship in client bundle), AND
 *   2. razorpay_key_secret is set in GymSettings (encrypted at rest by settings service)
 *
 * Returning false means UI should hide all "Pay Online" buttons and Razorpay-related flows.
 */
export async function isOnlinePaymentEnabled(): Promise<boolean> {
  if (!process.env.RAZORPAY_KEY_ID) return false;
  const secret = await getSetting("razorpay_key_secret", "");
  return Boolean(secret);
}
