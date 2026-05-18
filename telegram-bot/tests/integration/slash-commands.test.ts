/**
 * Integration test: handleSlashCommand against real production blob.
 * Covers every command the owner can actually type.
 */
import { describe, it, expect, vi } from "vitest";
import { handleSlashCommand } from "../../src/commands.js";
import { BlobStoreRegistry } from "../../src/data/blob-store.js";
import { createAllowlistStore } from "../../src/data/allowlist-store.js";

vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob.example/allowlist.json" }),
}));

const BLOB_BASE_URL = "https://pp7z5lebia3tfhxs.public.blob.vercel-storage.com";
const registry = new BlobStoreRegistry(BLOB_BASE_URL);
const T = 30_000;

describe("integration: slash commands", () => {
  const baseCtx = {
    chatId: 12345,
    firstName: "Robin",
    registry,
    isOwner: true,
  };

  it("/ping → 'pong'", async () => {
    expect(await handleSlashCommand({ ...baseCtx, text: "/ping" })).toBe("pong");
  });

  it("/help → includes command list + example questions", async () => {
    const r = await handleSlashCommand({ ...baseCtx, text: "/help" });
    expect(r).toContain("/snapshot");
    expect(r).toContain("How much");
  });

  it("/start → greets by first name + includes help", async () => {
    const r = await handleSlashCommand({ ...baseCtx, text: "/start" });
    expect(r).toContain("Robin");
    expect(r).toContain("chat id 12345");
  });

  it("/snapshot → lists every gym + snapshot date + row counts", async () => {
    const r = await handleSlashCommand({ ...baseCtx, text: "/snapshot" });
    expect(r).toContain("Free Form Fitness");
    expect(r).toContain("EGYM Lokhandwala");
    expect(r).toMatch(/Snapshot date: \d{4}-\d{2}-\d{2}/);
    expect(r).toMatch(/payments=\d+/);
    // Critical: must NOT mislabel a 401/5xx as "no snapshot yet" (round-3 fix).
    // For the live test we expect both gyms healthy, so no "UNREACHABLE" either.
    expect(r).not.toContain("UNREACHABLE");
  }, T);

  it("/snapshot for an unreachable gym labels it loudly (synthetic registry)", async () => {
    // Inject a registry whose fetchLatest throws non-404 to simulate outage.
    const brokenReg = {
      for: () => ({
        gym: "freeform",
        fetchLatest: async () => { throw new Error("500 Internal Server Error"); },
        fetchCsv: async () => "",
      }),
    };
    const r = await handleSlashCommand({ ...baseCtx, text: "/snapshot", registry: brokenReg as any });
    expect(r).toContain("UNREACHABLE");
    expect(r).toContain("operator action needed");
    expect(r).not.toContain("no snapshot yet");
  });

  it("/snapshot for a missing gym (404) labels it as 'not seeded'", async () => {
    const missing = {
      for: () => ({
        gym: "freeform",
        fetchLatest: async () => { throw new Error("latest.json fetch failed: 404"); },
        fetchCsv: async () => "",
      }),
    };
    const r = await handleSlashCommand({ ...baseCtx, text: "/snapshot", registry: missing as any });
    expect(r).toContain("no snapshot yet");
    expect(r).not.toContain("UNREACHABLE");
  });

  it("/refresh → dispatch + success message", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const r = await handleSlashCommand({ ...baseCtx, text: "/refresh", dispatchRefresh: dispatch });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(r).toContain("Refresh started");
  });

  it("/refresh without dispatcher configured → clear error", async () => {
    const r = await handleSlashCommand({ ...baseCtx, text: "/refresh" });
    expect(r).toContain("not configured");
  });

  it("/refresh on dispatch failure → user sees the cause", async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error("403 forbidden"));
    const r = await handleSlashCommand({ ...baseCtx, text: "/refresh", dispatchRefresh: dispatch });
    expect(r).toContain("Couldn't trigger refresh");
    expect(r).toContain("403");
  });

  it("unknown slash command → null (passes through to LLM)", async () => {
    expect(await handleSlashCommand({ ...baseCtx, text: "what is the weather" })).toBeNull();
    expect(await handleSlashCommand({ ...baseCtx, text: "/unknown" })).toBeNull();
  });

  describe("owner-only commands", () => {
    // Helper: build a fresh allowlist store per call to avoid the
    // single-use Response body trap. Each `read()` invocation needs its
    // own Response instance.
    const makeStore = (payload: object = { approved: [] }) => {
      const fetcher = vi.fn().mockImplementation(async () =>
        new Response(JSON.stringify(payload)),
      );
      return createAllowlistStore({
        url: "https://blob.example/allowlist.json",
        token: "test",
        fetch: fetcher,
      });
    };

    it("/approve from non-owner → rejected", async () => {
      const r = await handleSlashCommand({
        ...baseCtx,
        text: "/approve 999",
        isOwner: false,
        allowlistStore: makeStore(),
      });
      expect(r).toContain("Only the owner");
    });

    it("/approve without chat id → usage message", async () => {
      const r = await handleSlashCommand({
        ...baseCtx,
        text: "/approve",
        allowlistStore: makeStore(),
      });
      expect(r).toContain("Usage:");
      expect(r).toContain("/approve");
    });

    it("/approve <id> [name] → confirmation", async () => {
      const r = await handleSlashCommand({
        ...baseCtx,
        text: "/approve 999 Daisy",
        allowlistStore: makeStore(),
      });
      expect(r).toContain("Approved chat 999");
      expect(r).toContain("Daisy");
    });

    it("/revoke <id> → confirmation", async () => {
      const r = await handleSlashCommand({
        ...baseCtx,
        text: "/revoke 999",
        allowlistStore: makeStore(),
      });
      expect(r).toContain("Removed chat 999");
    });

    it("/allowlist with empty list → friendly empty message", async () => {
      const r = await handleSlashCommand({
        ...baseCtx,
        text: "/allowlist",
        allowlistStore: makeStore(),
      });
      expect(r).toContain("No additional approved users");
    });

    it("/allowlist with entries → shows each", async () => {
      const store = makeStore({
        approved: [
          { chatId: 101, name: "Sales staff", addedAt: "2026-05-01T00:00:00Z", addedBy: 1 },
          { chatId: 102, addedAt: "2026-05-02T00:00:00Z", addedBy: 1 },
        ],
      });
      const r = await handleSlashCommand({ ...baseCtx, text: "/allowlist", allowlistStore: store });
      expect(r).toContain("101");
      expect(r).toContain("Sales staff");
      expect(r).toContain("102");
    });

    it("/allowlist when JSON is corrupt → operator-actionable message, not silent empty", async () => {
      const corruptFetch = vi.fn().mockImplementation(async () =>
        new Response("not json {"),
      );
      const store = createAllowlistStore({
        url: "https://blob.example/allowlist.json",
        token: "test",
        fetch: corruptFetch,
      });
      const r = await handleSlashCommand({ ...baseCtx, text: "/allowlist", allowlistStore: store });
      expect(r).toContain("Couldn't read allowlist");
      expect(r).toContain("not valid JSON");
    });
  });
});
