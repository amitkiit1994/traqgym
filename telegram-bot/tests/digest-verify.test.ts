import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Stub env before importing the digest module — its top-level CRON_SECRET
// read fires at import time even though the rest is lazy.
const ORIGINAL_ENV = { ...process.env };
beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = "t";
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = "1";
  process.env.WEBHOOK_SECRET = "s";
  process.env.OPENAI_API_KEY = "k";
  process.env.BLOB_READ_WRITE_TOKEN = "b";
  process.env.BLOB_BASE_URL = "https://x.blob.example";
  process.env.CRON_SECRET = "c";
});
afterAll(() => { process.env = ORIGINAL_ENV; });

const { extractGymSection, verifyBriefAgainstGroundTruth, istDateIso } =
  await import("../api/digest.js");

// Realistic brief shape from the digest-prompt.ts output spec. Exposed
// here because the previous regression (find on bare-name header
// returned empty body, so EVERY brief got false-positive "no rupee
// figures present") would only show up against a real shape.
const REAL_BRIEF = `GOOD MORNING — 2026-05-19

=== Free Form Fitness ===
Headline: ₹52,300 in (18% above avg) • 4 expiring this week
1. YESTERDAY'S MONEY: ₹52,300 • Cash ₹40,000 / GPay ₹12,300 • 12 payments
   • 7-day avg ₹44,000 (19% above)

=== EGYM Lokhandwala ===
Headline: ₹3,31,200 in
1. YESTERDAY'S MONEY: ₹3,31,200 • Cash ₹2,80,000 / GPay ₹51,200 • 24 payments

=== CROSS-GYM ACTIONS ===
- Call Saba Khan (8898054717) at FFF about her renewal expiring 22-May

📅 Snapshots: freeform=2026-05-18, egym=2026-05-18`;

describe("extractGymSection", () => {
  it("returns the BODY of a gym's section, not the header", () => {
    const body = extractGymSection(REAL_BRIEF, "Free Form Fitness");
    expect(body).toContain("YESTERDAY'S MONEY");
    expect(body).toContain("₹52,300");
    // Critical regression: previously returned the bare-name segment
    // (" Free Form Fitness "), which has no rupee figures.
    expect(body).not.toMatch(/^\s*Free Form Fitness\s*$/);
  });

  it("isolates each gym's body — EGYM body must not include FFF body", () => {
    const egym = extractGymSection(REAL_BRIEF, "EGYM Lokhandwala");
    expect(egym).toContain("₹3,31,200");
    expect(egym).not.toContain("₹52,300");
  });

  it("returns null if the gym section is missing", () => {
    expect(extractGymSection(REAL_BRIEF, "Nonexistent Gym")).toBeNull();
  });

  it("matches case-insensitively", () => {
    expect(extractGymSection(REAL_BRIEF, "FREE FORM FITNESS")).not.toBeNull();
    expect(extractGymSection(REAL_BRIEF, "free form fitness")).not.toBeNull();
  });
});

describe("verifyBriefAgainstGroundTruth", () => {
  it("returns null when every gym's headline matches ground truth", () => {
    const result = verifyBriefAgainstGroundTruth(REAL_BRIEF, {
      freeform: 52_300,
      egym: 3_31_200,
    });
    expect(result).toBeNull();
  });

  it("tolerates rounding within 2% (LLM may round 52,300 to 52,000)", () => {
    const briefRounded = REAL_BRIEF.replace("₹52,300", "₹52,000")
                                   .replace("₹52,300", "₹52,000");
    const result = verifyBriefAgainstGroundTruth(briefRounded, {
      freeform: 52_300,
      egym: 3_31_200,
    });
    expect(result).toBeNull();
  });

  it("flags MISMATCHED headlines with the actual computed number", () => {
    const result = verifyBriefAgainstGroundTruth(REAL_BRIEF, {
      freeform: 99_999, // brief says ₹52,300
      egym: 3_31_200,
    });
    expect(result).toContain("VERIFICATION WARNING");
    expect(result).toContain("Free Form Fitness");
    expect(result).toContain("₹99,999");
  });

  it("flags MISSING gym sections", () => {
    const briefSansEgym = REAL_BRIEF.replace(/=== EGYM Lokhandwala ===[\s\S]*?=== CROSS/, "=== CROSS");
    const result = verifyBriefAgainstGroundTruth(briefSansEgym, {
      freeform: 52_300,
      egym: 3_31_200,
    });
    expect(result).toContain("EGYM Lokhandwala: section missing");
  });

  it("emits VERIFICATION SKIPPED for null computed (unhealthy CSV)", () => {
    const result = verifyBriefAgainstGroundTruth(REAL_BRIEF, {
      freeform: 52_300,
      egym: null,
    });
    expect(result).toContain("VERIFICATION SKIPPED");
    expect(result).toContain("EGYM Lokhandwala");
    expect(result).toContain("parser-flagged");
  });
});

describe("istDateIso", () => {
  it("returns the IST-local YYYY-MM-DD for a given UTC instant", () => {
    // 19:00 UTC on May 19 = 00:30 IST on May 20.
    const utcMay19_19h = new Date(Date.UTC(2026, 4, 19, 19, 0, 0));
    expect(istDateIso(utcMay19_19h)).toBe("2026-05-20");
  });

  it("returns the SAME date when the UTC instant is also in that IST day", () => {
    // 06:00 UTC on May 19 = 11:30 IST on May 19.
    const utcMay19_06h = new Date(Date.UTC(2026, 4, 19, 6, 0, 0));
    expect(istDateIso(utcMay19_06h)).toBe("2026-05-19");
  });
});
