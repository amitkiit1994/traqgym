import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

// Shared in-memory store for the mocked Prisma. Exposed via the mock so
// tests can reset it between cases.
const prismaStore = new Map<string, string>();

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
  requireWorker: vi.fn(() => Promise.resolve({ user: { id: "1", role: "admin", actorType: "worker", name: "test", locationId: 1 } })),
}));

// Mock next/cache so revalidatePath is a noop outside the Next runtime.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock global fetch for v3.fitnessboard.in calls
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("fitnessboard-setup actions", () => {
  beforeEach(() => {
    process.env.DATA_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    process.env.NEXTAUTH_SECRET = "test-secret";
    fetchMock.mockReset();
    prismaStore.clear();
    vi.resetModules();
  });

  it("validateFitnessboardLogin returns success on redirect to Branchlist", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: "/Dashboard/Branchlist" }),
    } as unknown as Response);
    const { validateFitnessboardLogin } = await import("@/lib/actions/fitnessboard-setup");
    const res = await validateFitnessboardLogin("9999999999", "secret-pw");
    expect(res.success).toBe(true);
  });

  it("validateFitnessboardLogin returns failure on LoginError redirect", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: "/Account/LoginError" }),
    } as unknown as Response);
    const { validateFitnessboardLogin } = await import("@/lib/actions/fitnessboard-setup");
    const res = await validateFitnessboardLogin("9999999999", "wrong-pw");
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error).toMatch(/credentials/i);
    }
  });

  it("validateFitnessboardLogin returns failure on unknown response", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({}),
    } as unknown as Response);
    const { validateFitnessboardLogin } = await import("@/lib/actions/fitnessboard-setup");
    const res = await validateFitnessboardLogin("9999999999", "x");
    expect(res.success).toBe(false);
  });

  it("validateFitnessboardLogin rejects malformed mobile", async () => {
    const { validateFitnessboardLogin } = await import("@/lib/actions/fitnessboard-setup");
    const res = await validateFitnessboardLogin("123", "x");
    expect(res.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saveFitnessboardConfig stores encrypted password and plaintext mobile/flag", async () => {
    const { saveFitnessboardConfig } = await import("@/lib/actions/fitnessboard-setup");
    const res = await saveFitnessboardConfig({ mobile: "9876543210", password: "secret", syncEnabled: true });
    expect(res.success).toBe(true);
    const { prisma } = await import("@/lib/prisma");
    const pwRow = await prisma.gymSettings.findUnique({ where: { key: "v3_fitnessboard_password" } });
    expect(pwRow?.value).toMatch(/^enc:v1:/);
    const mobRow = await prisma.gymSettings.findUnique({ where: { key: "v3_fitnessboard_mobile" } });
    expect(mobRow?.value).toBe("9876543210");
    const flagRow = await prisma.gymSettings.findUnique({ where: { key: "v3_sync_enabled" } });
    expect(flagRow?.value).toBe("true");
  });

  it("saveFitnessboardConfig rejects malformed mobile", async () => {
    const { saveFitnessboardConfig } = await import("@/lib/actions/fitnessboard-setup");
    const res = await saveFitnessboardConfig({ mobile: "abc", password: "x", syncEnabled: true });
    expect(res.success).toBe(false);
  });

  it("getFitnessboardStatus reports unconfigured initially", async () => {
    const { getFitnessboardStatus } = await import("@/lib/actions/fitnessboard-setup");
    const status = await getFitnessboardStatus();
    expect(status.configured).toBe(false);
  });

  it("getFitnessboardStatus reports configured after save and includes last-sync info", async () => {
    const { saveFitnessboardConfig, getFitnessboardStatus } = await import("@/lib/actions/fitnessboard-setup");
    await saveFitnessboardConfig({ mobile: "9876543210", password: "pw", syncEnabled: true });
    const { setSetting } = await import("@/lib/services/settings");
    await setSetting("v3_last_sync_at", "2026-05-16T00:00:00Z");
    await setSetting("v3_last_sync_status", "ok: 12 payments upserted");
    const status = await getFitnessboardStatus();
    expect(status.configured).toBe(true);
    expect(status.mobile).toBe("9876543210");
    expect(status.syncEnabled).toBe(true);
    expect(status.lastSyncAt).toBe("2026-05-16T00:00:00Z");
    expect(status.lastSyncStatus).toBe("ok: 12 payments upserted");
  });
});
