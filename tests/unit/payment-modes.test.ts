import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

vi.mock("@/lib/prisma", () => {
  const store = new Map<string, string>();
  return {
    prisma: {
      gymSettings: {
        findUnique: vi.fn(({ where }: { where: { key: string } }) =>
          Promise.resolve(store.has(where.key) ? { key: where.key, value: store.get(where.key) } : null)
        ),
        upsert: vi.fn(({ where, create, update }: { where: { key: string }; create: { key: string; value: string }; update: { value: string } }) => {
          store.set(where.key, store.has(where.key) ? update.value : create.value);
          return Promise.resolve({ key: where.key, value: store.get(where.key) });
        }),
      },
    },
  };
});

describe("payment modes", () => {
  beforeEach(async () => {
    process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    delete process.env.RAZORPAY_KEY_ID;
    vi.resetModules();
  });

  it("default modes = cash + upi", async () => {
    const { getEnabledPaymentModes } = await import("@/lib/services/payment-modes");
    const modes = await getEnabledPaymentModes();
    expect(modes).toEqual(["cash", "upi"]);
  });

  it("respects payment_modes_enabled setting (comma-separated)", async () => {
    const { setSetting } = await import("@/lib/services/settings");
    await setSetting("payment_modes_enabled", "cash,upi,card");
    const { getEnabledPaymentModes } = await import("@/lib/services/payment-modes");
    const modes = await getEnabledPaymentModes();
    expect(modes).toEqual(["cash", "upi", "card"]);
  });

  it("isOnlinePaymentEnabled requires both env key AND razorpay_key_secret in settings", async () => {
    const { isOnlinePaymentEnabled } = await import("@/lib/services/payment-modes");
    expect(await isOnlinePaymentEnabled()).toBe(false);

    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    vi.resetModules();
    const mod2 = await import("@/lib/services/payment-modes");
    expect(await mod2.isOnlinePaymentEnabled()).toBe(false); // secret missing

    const { setSetting } = await import("@/lib/services/settings");
    await setSetting("razorpay_key_secret", "abc123");
    vi.resetModules();
    const mod3 = await import("@/lib/services/payment-modes");
    expect(await mod3.isOnlinePaymentEnabled()).toBe(true);
  });
});
