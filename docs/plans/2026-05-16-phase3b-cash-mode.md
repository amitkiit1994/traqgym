# Phase 3b: Cash/UPI-only Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Remove the silent "stub mode" from Razorpay service. New default: Razorpay is OFF unless `RAZORPAY_KEY_ID` AND `razorpay_key_secret` (in GymSettings, encrypted) are configured. Add `isOnlinePaymentEnabled()` helper.

**Architecture:** Tighten `lib/services/razorpay.ts` to throw `ConfigurationError` instead of mock responses. Add `payment_modes_enabled` setting (default `"cash,upi"`). Provide `getEnabledPaymentModes()` helper for UI gating.

**Tech Stack:** No new deps. Uses existing settings service from Phase 2.5.

**Source spec:** `docs/specs/2026-05-16-path-to-prod-design.md` Phase 3b.

---

### Task 1: Add ConfigurationError + cash-mode helpers

**Files:**
- Create: `lib/services/errors.ts`
- Create: `lib/services/payment-modes.ts`
- Create: `tests/unit/payment-modes.test.ts`

- [ ] **Step 1: Write failing test** — create `tests/unit/payment-modes.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32) npx vitest run tests/unit/payment-modes.test.ts --config=vitest.unit.config.ts 2>&1 | tail -15
```

If `vitest.unit.config.ts` doesn't exist yet, create it first (the Phase 2.5 implementer flagged that pure unit tests need a config without DB globalSetup):

```typescript
// vitest.unit.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // No globalSetup — pure unit tests don't need DB
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

Then retry the vitest command. Expected: tests fail because `lib/services/payment-modes.ts` doesn't exist.

- [ ] **Step 3: Implement `lib/services/errors.ts`**

Create `lib/services/errors.ts`:

```typescript
/**
 * Service-layer error types.
 * Use these instead of generic Error so callers can branch on type.
 */

export class ConfigurationError extends Error {
  constructor(public readonly setting: string, message?: string) {
    super(message ?? `Required configuration missing: ${setting}`);
    this.name = "ConfigurationError";
  }
}

export class NotEnabledError extends Error {
  constructor(public readonly feature: string, message?: string) {
    super(message ?? `Feature not enabled for this gym: ${feature}`);
    this.name = "NotEnabledError";
  }
}
```

- [ ] **Step 4: Implement `lib/services/payment-modes.ts`**

Create `lib/services/payment-modes.ts`:

```typescript
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
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32) npx vitest run tests/unit/payment-modes.test.ts --config=vitest.unit.config.ts 2>&1 | tail -15
```

Expected: 3/3 pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git add lib/services/errors.ts lib/services/payment-modes.ts tests/unit/payment-modes.test.ts vitest.unit.config.ts
git commit -m "$(cat <<'EOF'
feat(payment): add payment-modes service + ConfigurationError

- lib/services/errors.ts: shared service-layer error types
- lib/services/payment-modes.ts: getEnabledPaymentModes() (default cash+upi),
  isOnlinePaymentEnabled() (requires env key + DB secret)
- vitest.unit.config.ts: DB-less unit test runner (deferred from Phase 2.5)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Tighten `lib/services/razorpay.ts` — remove silent stubs

**Files:**
- Modify: `lib/services/razorpay.ts`

- [ ] **Step 1: Replace the file contents**

Replace `lib/services/razorpay.ts` entirely with:

```typescript
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
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
npx tsc --noEmit 2>&1 | grep -E "razorpay" | head -10
```

Expected: NO output (no errors from our change).

- [ ] **Step 3: Verify no test breakage**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32) npx vitest run tests/unit/ --config=vitest.unit.config.ts 2>&1 | tail -15
```

Expected: all unit tests pass (12/12 — adds 3 from payment-modes to the 9 from Phase 2.5).

- [ ] **Step 4: Commit**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git add lib/services/razorpay.ts
git commit -m "$(cat <<'EOF'
fix(razorpay): remove silent stub mode; require explicit configuration

createOrder/verifyPayment now throw ConfigurationError or NotEnabledError
when RAZORPAY_KEY_ID env or razorpay_key_secret setting is missing —
previously they returned fake "stub_*" data, masking misconfiguration.

verifyPayment now does real HMAC-SHA256 signature verification with
timing-safe compare (was return { verified: true } before).

createOrder posts to https://api.razorpay.com/v1/orders with proper auth.

UI must check isOnlinePaymentEnabled() before showing online payment flows.
Default for new gyms: cash + UPI only.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Final verification

- [ ] **Step 1: Type check**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
npx tsc --noEmit 2>&1 | tail -10
```

Same error count as before (54 pre-existing) — no new errors. If new errors appear, fix them.

- [ ] **Step 2: All unit tests pass**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
DATA_ENCRYPTION_KEY=$(openssl rand -base64 32) npx vitest run tests/unit/ --config=vitest.unit.config.ts 2>&1 | tail -10
```

Expected: 12/12 pass.

- [ ] **Step 3: Git log check**

```bash
cd /Users/amitkumardas/freeformOS/freeformfitnessOS
git log --oneline -8
```

Expected: 2 new commits (Tasks 1, 2) on top of Phase 2.5.

## Done criteria

- [ ] `lib/services/errors.ts` exists
- [ ] `lib/services/payment-modes.ts` exists, 3 tests pass
- [ ] `lib/services/razorpay.ts` no longer has STUB_MODE — throws on misconfiguration
- [ ] `vitest.unit.config.ts` exists (also unblocks future DB-less unit tests)
- [ ] All unit tests pass (12/12)
- [ ] 2 commits on `main`

## Next phase trigger

Phase 3b done → write `docs/plans/2026-05-XX-phase3c-telegram.md`.
