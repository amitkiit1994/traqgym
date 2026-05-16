import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBlobStore, type LatestPointer } from "../src/data/blob-store.js";

const pointer: LatestPointer = {
  snapshot_date: "2026-05-16",
  snapshot_ist: "2026-05-16T06:02:11+05:30",
  row_counts: { payments: 670, members: 412 },
  blob_urls: {
    payments: "https://blob.example/csv/2026-05-16/payments-h1.csv",
    members:  "https://blob.example/csv/2026-05-16/members-h2.csv",
  },
};

describe("blob store", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("fetchLatest returns pointer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(pointer)));
    const store = createBlobStore({
      latestUrl: "https://blob.example/csv/latest.json",
      fetch: fetchMock,
    });
    const p = await store.fetchLatest();
    expect(p.snapshot_date).toBe("2026-05-16");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://blob.example/csv/latest.json",
      expect.anything(),
    );
  });

  it("fetchCsv reads URL from pointer", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(pointer)))
      .mockResolvedValueOnce(new Response("Sr No.,Paid Amount\n1,2000\n"));
    const store = createBlobStore({
      latestUrl: "https://blob.example/csv/latest.json",
      fetch: fetchMock,
    });
    const csv = await store.fetchCsv("payments");
    expect(csv).toContain("Paid Amount");
    expect(fetchMock).toHaveBeenLastCalledWith(pointer.blob_urls.payments, expect.anything());
  });

  it("throws on missing CSV name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(pointer)));
    const store = createBlobStore({
      latestUrl: "https://blob.example/csv/latest.json",
      fetch: fetchMock,
    });
    await expect(store.fetchCsv("doesnotexist")).rejects.toThrow(/doesnotexist/);
  });

  it("caches pointer for 60s", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(pointer)));
    const store = createBlobStore({
      latestUrl: "https://blob.example/csv/latest.json",
      fetch: fetchMock,
    });
    await store.fetchLatest();
    await store.fetchLatest();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
