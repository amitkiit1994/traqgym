import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createBlobStore,
  buildLatestUrl,
  BlobStoreRegistry,
  type LatestPointer,
} from "../src/data/blob-store.js";

const pointer: LatestPointer = {
  snapshot_date: "2026-05-17",
  snapshot_ist: "2026-05-17T06:02:11+05:30",
  row_counts: { payments: 670, members: 412 },
  blob_urls: {
    payments: "https://blob.example/csv/freeform/2026-05-17/payments-h1.csv",
    members: "https://blob.example/csv/freeform/2026-05-17/members-h2.csv",
  },
};

describe("buildLatestUrl", () => {
  it("joins base + csv/<gym>/latest.json", () => {
    expect(buildLatestUrl("https://x.blob.com", "freeform"))
      .toBe("https://x.blob.com/csv/freeform/latest.json");
    expect(buildLatestUrl("https://x.blob.com", "egym"))
      .toBe("https://x.blob.com/csv/egym/latest.json");
  });
  it("tolerates trailing slash on base", () => {
    expect(buildLatestUrl("https://x.blob.com/", "egym"))
      .toBe("https://x.blob.com/csv/egym/latest.json");
    expect(buildLatestUrl("https://x.blob.com///", "egym"))
      .toBe("https://x.blob.com/csv/egym/latest.json");
  });
});

describe("createBlobStore (per-gym)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("exposes the gym slug", () => {
    const store = createBlobStore({
      gym: "freeform",
      latestUrl: "https://x/csv/freeform/latest.json",
      fetch: vi.fn(),
    });
    expect(store.gym).toBe("freeform");
  });

  it("fetchLatest returns pointer for its gym", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(pointer)));
    const store = createBlobStore({
      gym: "freeform",
      latestUrl: "https://x/csv/freeform/latest.json",
      fetch: fetchMock,
    });
    const p = await store.fetchLatest();
    expect(p.snapshot_date).toBe("2026-05-17");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://x/csv/freeform/latest.json",
      expect.anything(),
    );
  });

  it("fetchCsv error includes the gym name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(pointer)));
    const store = createBlobStore({
      gym: "freeform",
      latestUrl: "https://x/csv/freeform/latest.json",
      fetch: fetchMock,
    });
    await expect(store.fetchCsv("nope")).rejects.toThrow(/freeform/);
    await expect(store.fetchCsv("nope")).rejects.toThrow(/Unknown CSV/);
  });

  it("caches pointer for 60s by default", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(pointer)));
    const store = createBlobStore({
      gym: "freeform",
      latestUrl: "https://x/csv/freeform/latest.json",
      fetch: fetchMock,
    });
    await store.fetchLatest();
    await store.fetchLatest();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("BlobStoreRegistry", () => {
  it("returns the same store instance for the same gym", () => {
    const reg = new BlobStoreRegistry("https://x.blob.com", vi.fn());
    const a = reg.for("freeform");
    const b = reg.for("freeform");
    expect(a).toBe(b);
  });

  it("creates distinct stores for different gyms with correct URLs", async () => {
    // Each call returns a fresh Response (bodies can only be read once).
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(pointer))),
    );
    const reg = new BlobStoreRegistry("https://x.blob.com", fetchMock);
    const free = reg.for("freeform");
    const egym = reg.for("egym");
    expect(free.gym).toBe("freeform");
    expect(egym.gym).toBe("egym");
    await free.fetchLatest();
    await egym.fetchLatest();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1, "https://x.blob.com/csv/freeform/latest.json", expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2, "https://x.blob.com/csv/egym/latest.json", expect.anything(),
    );
  });
});
