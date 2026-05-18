import { describe, it, expect } from "vitest";
import {
  loadSnapshotsWith,
  snapshotsLine,
  snapshotDatesOnly,
  anySnapshotLoaded,
} from "../api/digest.js";

// Drive loadSnapshotsWith with a tiny fake `fetchLatestFor` so we exercise
// every status branch without standing up real Vercel Blob.
async function ok(slug: string) { return { snapshot_date: `2026-05-${slug.length}` }; }
async function missing(_: string): Promise<{ snapshot_date: string }> {
  throw new Error("404 Not Found");
}
async function networkFail(_: string): Promise<{ snapshot_date: string }> {
  throw new Error("ETIMEDOUT fetching latest.json");
}

const gyms = [{ slug: "freeform" }, { slug: "egym" }] as const;

describe("loadSnapshotsWith", () => {
  it("returns status=ok with the snapshot date when the fetch succeeds", async () => {
    const out = await loadSnapshotsWith(ok, gyms);
    expect(out.freeform).toEqual({ status: "ok", date: "2026-05-8" });
    expect(out.egym).toEqual({ status: "ok", date: "2026-05-4" });
  });

  it("returns status=missing for 404 / not-found responses (gym not yet seeded)", async () => {
    const out = await loadSnapshotsWith(missing, gyms);
    expect(out.freeform).toEqual({ status: "missing" });
    expect(out.egym).toEqual({ status: "missing" });
  });

  it("returns status=error with the reason for non-404 failures", async () => {
    const out = await loadSnapshotsWith(networkFail, gyms);
    expect(out.freeform.status).toBe("error");
    if (out.freeform.status === "error") {
      expect(out.freeform.reason).toContain("ETIMEDOUT");
    }
  });

  it("handles mixed-status correctly (one ok, one missing, one error)", async () => {
    const mixed = async (slug: string) => {
      if (slug === "freeform") return { snapshot_date: "2026-05-18" };
      if (slug === "egym") throw new Error("404");
      throw new Error("connection refused");
    };
    const out = await loadSnapshotsWith(mixed, [
      { slug: "freeform" },
      { slug: "egym" },
      { slug: "third" },
    ]);
    expect(out.freeform.status).toBe("ok");
    expect(out.egym.status).toBe("missing");
    expect(out.third.status).toBe("error");
  });
});

describe("snapshotDatesOnly", () => {
  it("filters out missing and error statuses, keeps only ok dates", () => {
    const out = snapshotDatesOnly({
      a: { status: "ok", date: "2026-05-18" },
      b: { status: "missing" },
      c: { status: "error", reason: "boom" },
      d: { status: "ok", date: "2026-05-17" },
    });
    expect(out).toEqual({ a: "2026-05-18", d: "2026-05-17" });
  });

  it("returns empty object when no gym has a loaded snapshot", () => {
    expect(snapshotDatesOnly({
      a: { status: "missing" },
      b: { status: "error", reason: "x" },
    })).toEqual({});
  });
});

describe("anySnapshotLoaded", () => {
  it("returns true when at least one gym has status=ok", () => {
    expect(anySnapshotLoaded({
      a: { status: "ok", date: "2026-05-18" },
      b: { status: "error", reason: "x" },
    })).toBe(true);
  });

  it("returns false when every gym is missing/error — digest should refuse", () => {
    expect(anySnapshotLoaded({
      a: { status: "missing" },
      b: { status: "error", reason: "x" },
    })).toBe(false);
  });

  it("returns false on empty input", () => {
    expect(anySnapshotLoaded({})).toBe(false);
  });
});

describe("snapshotsLine (system prompt rendering)", () => {
  it("renders UNAVAILABLE for error states so the LLM knows to refuse", () => {
    const line = snapshotsLine({
      freeform: { status: "ok", date: "2026-05-18" },
      egym: { status: "error", reason: "ETIMEDOUT" },
    });
    expect(line).toContain("UNAVAILABLE");
    expect(line).toContain("ETIMEDOUT");
    expect(line).toContain("snapshot 2026-05-18");
  });

  it("renders (no snapshot yet) for missing state", () => {
    const line = snapshotsLine({
      freeform: { status: "missing" },
      egym: { status: "ok", date: "2026-05-18" },
    });
    expect(line).toContain("(no snapshot yet)");
  });
});
