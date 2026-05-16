import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

// Shared in-memory store for the mocked Prisma. Exposed via the mock so
// tests can reset it between cases (vi.resetModules does not re-run
// vi.mock factories, so the closure persists across tests).
const prismaStore = new Map<string, string>();

// Mock Prisma
vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      gymSettings: {
        findUnique: vi.fn(({ where }: { where: { key: string } }) =>
          Promise.resolve(prismaStore.has(where.key) ? { key: where.key, value: prismaStore.get(where.key) } : null)
        ),
        upsert: vi.fn(({ where, create, update }: { where: { key: string }; create: { key: string; value: string }; update: { value: string } }) => {
          prismaStore.set(where.key, prismaStore.has(where.key) ? update.value : create.value);
          return Promise.resolve({ key: where.key, value: prismaStore.get(where.key) });
        }),
      },
    },
  };
});

// Mock auth-guard so we don't need a session
vi.mock("@/lib/auth-guard", () => ({
  requireWorker: vi.fn(() => Promise.resolve({ userId: 1, role: "admin", locationId: 1 })),
}));

// Mock next/cache so revalidatePath is a noop outside the Next runtime.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock global fetch for Telegram API calls
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("telegram-setup actions", () => {
  beforeEach(() => {
    process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    process.env.NEXTAUTH_SECRET = "test-secret-for-pair-code";
    process.env.NEXTAUTH_URL = "https://freeformfitness.traqgym.com";
    fetchMock.mockReset();
    prismaStore.clear();
    vi.resetModules();
  });

  it("validateBotToken returns bot info when token is valid", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { id: 12345, is_bot: true, first_name: "TraqBot", username: "traqgym_test_bot" } }),
    } as Response);
    const { validateBotToken } = await import("@/lib/actions/telegram-setup");
    const res = await validateBotToken("12345:fake-token");
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.botUsername).toBe("traqgym_test_bot");
      expect(res.botName).toBe("TraqBot");
    }
  });

  it("validateBotToken returns error on invalid token", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ ok: false, description: "Unauthorized" }),
    } as Response);
    const { validateBotToken } = await import("@/lib/actions/telegram-setup");
    const res = await validateBotToken("bad-token");
    expect(res.success).toBe(false);
  });

  it("configureBot stores token + secret + calls setWebhook", async () => {
    // getMe
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: { id: 1, is_bot: true, first_name: "B", username: "b" } }),
    } as Response);
    // setWebhook
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    } as Response);

    const { configureBot } = await import("@/lib/actions/telegram-setup");
    const res = await configureBot({ botToken: "12345:fake" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.botUsername).toBe("b");
      expect(res.pairCode).toMatch(/^[0-9a-f]{8}$/);
      expect(res.webhookUrl).toContain("/api/webhook/telegram");
    }

    // Token stored encrypted
    const { prisma } = await import("@/lib/prisma");
    const tokenRow = await prisma.gymSettings.findUnique({ where: { key: "telegram_bot_token" } });
    expect(tokenRow?.value).toMatch(/^enc:v1:/);
    // Username stored plaintext
    const usernameRow = await prisma.gymSettings.findUnique({ where: { key: "telegram_bot_username" } });
    expect(usernameRow?.value).toBe("b");
    // Webhook secret stored encrypted
    const secretRow = await prisma.gymSettings.findUnique({ where: { key: "telegram_webhook_secret" } });
    expect(secretRow?.value).toMatch(/^enc:v1:/);
  });

  it("getSetupStatus reports configured/unconfigured correctly", async () => {
    const { getSetupStatus } = await import("@/lib/actions/telegram-setup");
    const before = await getSetupStatus();
    expect(before.configured).toBe(false);

    const { setSetting } = await import("@/lib/services/settings");
    await setSetting("telegram_bot_token", "12345:fake");
    await setSetting("telegram_bot_username", "demo_bot");

    const after = await getSetupStatus();
    expect(after.configured).toBe(true);
    expect(after.botUsername).toBe("demo_bot");
    expect(after.pairCode).toMatch(/^[0-9a-f]{8}$/);
  });
});
