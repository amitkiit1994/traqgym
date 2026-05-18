import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAllowlistStore } from "../src/data/allowlist-store.js";

// Mock the @vercel/blob put() so we don't hit the network in unit tests.
vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob.example/allowlist.json" }),
}));

describe("allowlist store", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("returns empty list when file is missing (404)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    const s = createAllowlistStore({ url: "u", token: "t", fetch: fetchMock });
    const al = await s.read();
    expect(al.approved).toEqual([]);
  });

  it("reads existing allowlist", async () => {
    const json = JSON.stringify({
      approved: [{ chatId: 1, addedAt: "2026-05-17T00:00:00Z", addedBy: 99 }],
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(json));
    const s = createAllowlistStore({ url: "u", token: "t", fetch: fetchMock });
    const al = await s.read();
    expect(al.approved).toHaveLength(1);
    expect(al.approved[0]!.chatId).toBe(1);
  });

  it("caches reads for the TTL window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ approved: [] })));
    const s = createAllowlistStore({ url: "u", token: "t", fetch: fetchMock });
    await s.read();
    await s.read();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("add() de-duplicates by chatId", async () => {
    const initial = { approved: [{ chatId: 5, addedAt: "x", addedBy: 1 }] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(initial)));
    const s = createAllowlistStore({ url: "u", token: "t", fetch: fetchMock });
    const next = await s.add({ chatId: 5, name: "robin", addedAt: "y", addedBy: 1 });
    expect(next.approved).toHaveLength(1);
    expect(next.approved[0]!.name).toBe("robin");
  });

  it("remove() drops the matching chatId", async () => {
    const initial = {
      approved: [
        { chatId: 5, addedAt: "x", addedBy: 1 },
        { chatId: 6, addedAt: "x", addedBy: 1 },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(initial)));
    const s = createAllowlistStore({ url: "u", token: "t", fetch: fetchMock });
    const next = await s.remove(5);
    expect(next.approved.map(e => e.chatId)).toEqual([6]);
  });

  it("treats malformed json as empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{\"approved\":\"oops\"}"));
    const s = createAllowlistStore({ url: "u", token: "t", fetch: fetchMock });
    const al = await s.read();
    expect(al.approved).toEqual([]);
  });

  // Original bug: add()/remove() went through the 30s read-cache, so a
  // stale read could write a payload missing a newly-added entry from a
  // concurrent /approve. add() and remove() now force-fresh the read.
  it("add() bypasses the read cache so concurrent mutations see latest", async () => {
    // First read returns empty (gets cached). Then someone else adds chat 7.
    // Our add(8) should fetch fresh and see {7}, then write {7, 8} — not
    // overwrite to just {8} based on the cached empty value.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ approved: [] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          approved: [{ chatId: 7, addedAt: "z", addedBy: 1 }],
        })),
      );
    const s = createAllowlistStore({ url: "u", token: "t", fetch: fetchMock });
    await s.read(); // warms cache with []
    const next = await s.add({ chatId: 8, addedAt: "now", addedBy: 1 });
    const ids = next.approved.map(e => e.chatId).sort();
    expect(ids).toEqual([7, 8]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("remove() bypasses the read cache so concurrent mutations see latest", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ approved: [{ chatId: 7, addedAt: "x", addedBy: 1 }] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          approved: [
            { chatId: 7, addedAt: "x", addedBy: 1 },
            { chatId: 9, addedAt: "y", addedBy: 1 },
          ],
        })),
      );
    const s = createAllowlistStore({ url: "u", token: "t", fetch: fetchMock });
    await s.read(); // warm cache
    const next = await s.remove(7);
    expect(next.approved.map(e => e.chatId)).toEqual([9]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
