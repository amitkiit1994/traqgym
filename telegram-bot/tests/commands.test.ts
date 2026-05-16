import { describe, it, expect, vi } from "vitest";
import { handleSlashCommand } from "../src/commands.js";
import type { BlobStore } from "../src/data/blob-store.js";

const pointer = {
  snapshot_date: "2026-05-16",
  snapshot_ist: "2026-05-16T06:02:11+05:30",
  row_counts: { payments: 670, members: 412 },
  blob_urls: { payments: "u1", members: "u2" },
};
const store: BlobStore = {
  fetchLatest: vi.fn().mockResolvedValue(pointer),
  fetchCsv: vi.fn(),
};

describe("handleSlashCommand", () => {
  it("/start returns welcome with chat id", async () => {
    const r = await handleSlashCommand({
      text: "/start", chatId: 42, firstName: "Robin", store, dispatchRefresh: vi.fn(),
    });
    expect(r).toMatch(/Robin/);
    expect(r).toMatch(/42/);
  });
  it("/ping returns pong", async () => {
    const r = await handleSlashCommand({
      text: "/ping", chatId: 1, firstName: "x", store, dispatchRefresh: vi.fn(),
    });
    expect(r).toBe("pong");
  });
  it("/snapshot returns date + row counts", async () => {
    const r = await handleSlashCommand({
      text: "/snapshot", chatId: 1, firstName: "x", store, dispatchRefresh: vi.fn(),
    });
    expect(r).toMatch(/2026-05-16/);
    expect(r).toMatch(/670/);
  });
  it("/help returns example questions", async () => {
    const r = await handleSlashCommand({
      text: "/help", chatId: 1, firstName: "x", store, dispatchRefresh: vi.fn(),
    });
    expect(r!.toLowerCase()).toMatch(/example|how much|members/);
  });
  it("/refresh invokes dispatchRefresh", async () => {
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const r = await handleSlashCommand({
      text: "/refresh", chatId: 1, firstName: "x", store, dispatchRefresh: dispatch,
    });
    expect(dispatch).toHaveBeenCalled();
    expect(r).toMatch(/refresh started/i);
  });
  it("/refresh without PAT replies disabled", async () => {
    const r = await handleSlashCommand({
      text: "/refresh", chatId: 1, firstName: "x", store, dispatchRefresh: undefined,
    });
    expect(r).toMatch(/not configured/i);
  });
  it("returns null for non-slash text", async () => {
    const r = await handleSlashCommand({
      text: "how much last week", chatId: 1, firstName: "x", store, dispatchRefresh: vi.fn(),
    });
    expect(r).toBeNull();
  });
});
