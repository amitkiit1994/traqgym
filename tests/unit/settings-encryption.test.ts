import { describe, it, expect, beforeAll, vi } from "vitest";
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

describe("settings encryption wrapper", () => {
  beforeAll(() => {
    process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  });

  it("encrypts whitelisted keys on write, decrypts on read", async () => {
    const { setSetting, getSetting } = await import("@/lib/services/settings");
    await setSetting("smtp_pass", "p@ssw0rd");
    const { prisma } = await import("@/lib/prisma");
    const stored = await prisma.gymSettings.findUnique({ where: { key: "smtp_pass" } });
    expect(stored?.value).toMatch(/^enc:v1:/);
    const read = await getSetting("smtp_pass", "");
    expect(read).toBe("p@ssw0rd");
  });

  it("leaves non-whitelisted keys plaintext", async () => {
    const { setSetting } = await import("@/lib/services/settings");
    await setSetting("gym_name", "Free Form Fitness");
    const { prisma } = await import("@/lib/prisma");
    const stored = await prisma.gymSettings.findUnique({ where: { key: "gym_name" } });
    expect(stored?.value).toBe("Free Form Fitness");
  });

  it("getSetting handles already-encrypted legacy data transparently", async () => {
    const { encrypt } = await import("@/lib/services/crypto");
    const { setSetting, getSetting } = await import("@/lib/services/settings");
    const { prisma } = await import("@/lib/prisma");
    // Simulate a legacy plaintext secret that was migrated
    await prisma.gymSettings.upsert({
      where: { key: "msg91_auth_key" },
      create: { key: "msg91_auth_key", value: encrypt("legacy-secret-value") },
      update: { value: encrypt("legacy-secret-value") },
    });
    expect(await getSetting("msg91_auth_key", "")).toBe("legacy-secret-value");
  });

  it("getSetting handles plaintext values for whitelisted keys (pre-migration)", async () => {
    const { setSetting, getSetting } = await import("@/lib/services/settings");
    const { prisma } = await import("@/lib/prisma");
    // Simulate a pre-migration plaintext value (admin saved it before encryption was deployed)
    await prisma.gymSettings.upsert({
      where: { key: "telegram_bot_token" },
      create: { key: "telegram_bot_token", value: "plaintext-token-123" },
      update: { value: "plaintext-token-123" },
    });
    expect(await getSetting("telegram_bot_token", "")).toBe("plaintext-token-123");
  });
});
