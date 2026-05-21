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

const {
  extractGymSection,
  verifyBriefAgainstGroundTruth,
  redactUnhealthySections,
  overrideSection1FromGroundTruth,
  istDateIso,
} = await import("../api/digest.js");

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

  // 2026-05-21 regression: brief shipped with fabricated FFF headline
  // ₹52,300 (real: ₹12,000) and fabricated EGYM headline ₹71,000 (real:
  // ₹11,000). The Cash sub-line happened to equal expected for each gym
  // (₹12,000 / ₹11,000), so the old "any rupee figure in section matches"
  // verifier silently passed. Headline-anchored check catches it.
  it("FLAGS fabricated headline even when a sub-line happens to equal expected", () => {
    const briefWithMatchingSubline = `GOOD MORNING — 2026-05-21

=== Free Form Fitness ===
Headline: ₹52,300 in (18% above avg)
1. YESTERDAY'S MONEY: ₹52,300 • Cash ₹12,000 / GPay ₹40,300 • 5 payments

=== EGYM Lokhandwala ===
Headline: ₹71,000 in
1. YESTERDAY'S MONEY: ₹71,000 • Cash ₹11,000 / GPay ₹60,000 • 5 payments

=== CROSS-GYM ACTIONS ===
- nothing`;
    const result = verifyBriefAgainstGroundTruth(briefWithMatchingSubline, {
      freeform: 12_000,
      egym: 11_000,
    });
    expect(result).toContain("VERIFICATION WARNING");
    expect(result).toContain("Free Form Fitness");
    expect(result).toContain("EGYM Lokhandwala");
    expect(result).toContain("₹52,300");
    expect(result).toContain("₹12,000");
    expect(result).toContain("₹71,000");
    expect(result).toContain("₹11,000");
  });
});

describe("overrideSection1FromGroundTruth", () => {
  const TRUTH_FFF = {
    total: 12_000,
    count: 1,
    byMode: { Cash: 12_000, GPay: 0, Other: 0 },
    sevenDayAvg: 10_714,
  };
  const TRUTH_EGYM = {
    total: 11_000,
    count: 1,
    byMode: { Cash: 11_000, GPay: 0, Other: 0 },
    sevenDayAvg: 22_143,
  };

  it("replaces fabricated headline + section 1 with computed ground truth", () => {
    const fabricated = `GOOD MORNING — 2026-05-21

=== Free Form Fitness ===
Headline: ₹52,300 in (18% above avg)
1. YESTERDAY'S MONEY: ₹52,300 • Cash ₹12,000 / GPay ₹40,300 • 5 payments
   • 7-day avg ₹44,400 (18% above)
2. EXPIRING SOON: ₹75,900.
3. OUTSTANDING DUES: ₹45,000.

=== EGYM Lokhandwala ===
Headline: ₹71,000 in
1. YESTERDAY'S MONEY: ₹71,000 • Cash ₹11,000 / GPay ₹60,000 • 5 payments
   • 7-day avg ₹61,000 (15% above)
2. EXPIRING SOON: ₹0.

=== CROSS-GYM ACTIONS ===
- nothing`;
    const { brief, overridden } = overrideSection1FromGroundTruth(fabricated, {
      freeform: TRUTH_FFF,
      egym: TRUTH_EGYM,
    });
    expect(overridden).toEqual(
      expect.arrayContaining([
        { gymName: "Free Form Fitness", was: 52_300, now: 12_000 },
        { gymName: "EGYM Lokhandwala", was: 71_000, now: 11_000 },
      ]),
    );
    expect(overridden).toHaveLength(2);
    // FFF body must reflect ground truth, not the LLM's fabrication.
    const fff = extractGymSection(brief, "Free Form Fitness")!;
    expect(fff).toContain("Headline: ₹12,000 in");
    expect(fff).toContain("1. YESTERDAY'S MONEY: ₹12,000 • Cash ₹12,000 • 1 payment");
    expect(fff).toContain("7-day avg ₹10,714");
    expect(fff).toContain("[OVERRIDE");
    expect(fff).toContain("LLM said ₹52,300");
    // The fabricated GPay / payment count must be GONE.
    expect(fff).not.toContain("₹40,300");
    expect(fff).not.toContain("5 payments");
    // Sections 2-5 must survive untouched.
    expect(fff).toContain("2. EXPIRING SOON: ₹75,900");
    expect(fff).toContain("3. OUTSTANDING DUES: ₹45,000");
    // EGYM same.
    const egym = extractGymSection(brief, "EGYM Lokhandwala")!;
    expect(egym).toContain("Headline: ₹11,000 in");
    expect(egym).toContain("Cash ₹11,000");
    expect(egym).not.toContain("₹60,000");
  });

  // 2026-05-21 regression #2: brief shipped `Headline: ₹12,000 in (skipped
  // — payments CSV column misaligned)` AND `1. YESTERDAY'S MONEY: (skipped
  // — ...)`. Headline number matched ground truth so the old "headline
  // matches → no-op" shortcut left section 1 in its skipped state — the
  // operator saw a self-contradicting brief. Both lines must match
  // ground truth for the no-op to apply.
  it("overrides when Headline is correct but section 1 is tagged skipped", () => {
    const contradictory = `GOOD MORNING — 2026-05-21

=== Free Form Fitness ===
Headline: ₹12,000 in (skipped — payments CSV column misaligned in today's snapshot — operator action needed)
1. YESTERDAY'S MONEY: (skipped — payments CSV column misaligned in today's snapshot — operator action needed)
2. EXPIRING SOON: ₹61,050.

=== CROSS-GYM ACTIONS ===
- nothing`;
    const { brief, overridden } = overrideSection1FromGroundTruth(contradictory, {
      freeform: TRUTH_FFF,
    });
    expect(overridden).toEqual([
      { gymName: "Free Form Fitness", was: 12_000, now: 12_000 },
    ]);
    // Section 1 must be rewritten to the clean ground-truth form, not the
    // LLM's skip marker.
    const fff = extractGymSection(brief, "Free Form Fitness")!;
    expect(fff).toContain("1. YESTERDAY'S MONEY: ₹12,000 • Cash ₹12,000 • 1 payment");
    expect(fff).toContain("[OVERRIDE");
    expect(fff).not.toMatch(/^[ \t]*1\.[^\n]*skipped/m);
    // Section 2 must survive.
    expect(fff).toContain("2. EXPIRING SOON: ₹61,050");
  });

  it("no-ops when LLM headline already matches ground truth within 2%", () => {
    // LLM said ₹12,100 (within 2% of ₹12,000 ground truth — rounding OK)
    const accurate = `GOOD MORNING — 2026-05-21

=== Free Form Fitness ===
Headline: ₹12,100 in
1. YESTERDAY'S MONEY: ₹12,100 • Cash ₹12,100 • 1 payment

=== EGYM Lokhandwala ===
Headline: ₹11,000 in
1. YESTERDAY'S MONEY: ₹11,000 • Cash ₹11,000 • 1 payment

=== CROSS-GYM ACTIONS ===
- nothing`;
    const { brief, overridden } = overrideSection1FromGroundTruth(accurate, {
      freeform: TRUTH_FFF,
      egym: TRUTH_EGYM,
    });
    expect(overridden).toEqual([]);
    expect(brief).toBe(accurate);
  });

  it("skips gyms whose body was already redacted (unhealthy CSV)", () => {
    const partiallyRedacted = `GOOD MORNING — 2026-05-21

=== Free Form Fitness ===
Headline: (payments data unreadable today)
1. YESTERDAY'S MONEY: (skipped — payments CSV column misaligned in today's snapshot — operator action needed)

=== EGYM Lokhandwala ===
Headline: ₹71,000 in
1. YESTERDAY'S MONEY: ₹71,000 • Cash ₹11,000 / GPay ₹60,000 • 5 payments

=== CROSS-GYM ACTIONS ===
- nothing`;
    const { brief, overridden } = overrideSection1FromGroundTruth(
      partiallyRedacted,
      { freeform: TRUTH_FFF, egym: TRUTH_EGYM },
      new Set(["Free Form Fitness"]),
    );
    // FFF stays redacted — override does NOT overwrite the skip marker.
    expect(brief).toContain("(payments data unreadable today)");
    expect(brief).toContain("(skipped — payments CSV column misaligned");
    // EGYM gets overridden as normal.
    expect(overridden.map(o => o.gymName)).toEqual(["EGYM Lokhandwala"]);
    expect(brief).toContain("Headline: ₹11,000 in");
  });

  it("falls back to section-1 number when LLM dropped the Headline line", () => {
    const noHeadline = `GOOD MORNING — 2026-05-21

=== Free Form Fitness ===
1. YESTERDAY'S MONEY: ₹52,300 • Cash ₹12,000 / GPay ₹40,300 • 5 payments

=== CROSS-GYM ACTIONS ===
- nothing`;
    const { brief, overridden } = overrideSection1FromGroundTruth(noHeadline, {
      freeform: TRUTH_FFF,
    });
    expect(overridden).toHaveLength(1);
    expect(overridden[0]!.was).toBe(52_300); // picked up from section 1
    // Override should still produce a valid Headline line.
    expect(brief).toContain("Headline: ₹12,000 in");
  });

  it("emits 'no headline' note when LLM dropped both lines", () => {
    const noNumbers = `GOOD MORNING — 2026-05-21

=== Free Form Fitness ===
(snapshot weirdness, no clear money line)
2. EXPIRING SOON: ₹0.

=== CROSS-GYM ACTIONS ===
- nothing`;
    const { brief, overridden } = overrideSection1FromGroundTruth(noNumbers, {
      freeform: TRUTH_FFF,
    });
    expect(overridden).toHaveLength(1);
    expect(overridden[0]!.was).toBeNull();
    expect(brief).toContain("LLM dropped headline number");
    expect(brief).toContain("Headline: ₹12,000 in");
  });

  it("skips gym entries with null ground truth (unhealthy CSV — redactor's job)", () => {
    const { overridden } = overrideSection1FromGroundTruth(REAL_BRIEF, {
      freeform: null,
      egym: TRUTH_EGYM,
    });
    expect(overridden.map(o => o.gymName)).toEqual(["EGYM Lokhandwala"]);
  });

  // Edge: section 1 is the entire gym body (no sections 2-5, gym is the
  // LAST `===` block, so the body slot has no trailing `===` either). The
  // section1Re's `\s*$(?![\r\n])` end-of-string anchor must handle this —
  // otherwise the rewrite silently no-ops and the operator gets the
  // fabricated number anyway.
  it("rewrites when section 1 is the only section AND the gym is the last block", () => {
    const minimal = `GOOD MORNING — 2026-05-21

=== Free Form Fitness ===
Headline: ₹52,300 in
1. YESTERDAY'S MONEY: ₹52,300 • Cash ₹40,000 / GPay ₹12,300 • 7 payments`;
    const { brief, overridden } = overrideSection1FromGroundTruth(minimal, {
      freeform: TRUTH_FFF,
    });
    expect(overridden).toEqual([
      { gymName: "Free Form Fitness", was: 52_300, now: 12_000 },
    ]);
    expect(brief).toContain("Headline: ₹12,000 in");
    expect(brief).toContain("1. YESTERDAY'S MONEY: ₹12,000 • Cash ₹12,000 • 1 payment");
    // The [OVERRIDE] audit marker deliberately preserves the LLM's old
    // value so the operator can see what was replaced. The fabricated
    // breakdown / payment count, however, must be gone.
    expect(brief).toContain("[OVERRIDE — LLM said ₹52,300");
    expect(brief).not.toContain("Cash ₹40,000");
    expect(brief).not.toContain("GPay ₹12,300");
    expect(brief).not.toContain("7 payments");
  });
});

describe("redactUnhealthySections", () => {
  it("rewrites Headline + section 1 when a gym is unhealthy, leaves the other gym untouched", () => {
    const { brief, redacted } = redactUnhealthySections(REAL_BRIEF, {
      freeform: 52_300,
      egym: null,
    });
    // EGYM section: Headline and section 1 must be replaced.
    const egymBody = extractGymSection(brief, "EGYM Lokhandwala")!;
    expect(egymBody).toContain("Headline: (payments data unreadable today)");
    expect(egymBody).toContain("(skipped — payments CSV column misaligned");
    expect(egymBody).not.toContain("₹3,31,200");
    expect(egymBody).not.toContain("Cash ₹2,80,000");
    // FFF section: untouched.
    const fffBody = extractGymSection(brief, "Free Form Fitness")!;
    expect(fffBody).toContain("₹52,300");
    expect(fffBody).toContain("Cash ₹40,000");
    expect(redacted).toEqual(["EGYM Lokhandwala"]);
  });

  it("returns brief unchanged when every gym is healthy", () => {
    const { brief, redacted } = redactUnhealthySections(REAL_BRIEF, {
      freeform: 52_300,
      egym: 3_31_200,
    });
    expect(brief).toBe(REAL_BRIEF);
    expect(redacted).toEqual([]);
  });

  it("rewrites every gym when all are unhealthy", () => {
    const { brief, redacted } = redactUnhealthySections(REAL_BRIEF, {
      freeform: null,
      egym: null,
    });
    expect(brief).not.toContain("₹52,300");
    expect(brief).not.toContain("₹3,31,200");
    // CROSS-GYM ACTIONS section must survive intact.
    expect(brief).toContain("=== CROSS-GYM ACTIONS ===");
    expect(brief).toContain("Saba Khan");
    expect(redacted).toEqual(["Free Form Fitness", "EGYM Lokhandwala"]);
  });

  it("redacts BOTH gyms when their bodies happen to be byte-identical", () => {
    // Regression: an earlier `out.split(body).join(rewritten)` impl would
    // mutate both copies on the first pass, so the second iteration found
    // nothing to change and silently dropped the gym from `redacted`.
    const identicalBody = `\nHeadline: ₹0 in\n1. YESTERDAY'S MONEY: ₹0\n`;
    const twin =
      `GOOD MORNING — 2026-05-19\n\n` +
      `=== Free Form Fitness ===${identicalBody}` +
      `=== EGYM Lokhandwala ===${identicalBody}` +
      `=== CROSS-GYM ACTIONS ===\n- nothing\n`;
    const { brief, redacted } = redactUnhealthySections(twin, {
      freeform: null,
      egym: null,
    });
    expect(redacted).toEqual(["Free Form Fitness", "EGYM Lokhandwala"]);
    // Both sections rewritten — there should be two skip markers.
    const skipCount = (brief.match(/payments data unreadable today/g) ?? []).length;
    expect(skipCount).toBe(2);
  });

  it("does not crash on a brief that dropped the Headline line", () => {
    const briefNoHeadline = REAL_BRIEF.replace(/^Headline:[^\n]*\n/m, "");
    expect(() =>
      redactUnhealthySections(briefNoHeadline, { freeform: null, egym: 3_31_200 }),
    ).not.toThrow();
    const { brief, redacted } = redactUnhealthySections(briefNoHeadline, {
      freeform: null,
      egym: 3_31_200,
    });
    // The replacement marker should still appear for FFF.
    expect(brief).toContain("payments data unreadable today");
    expect(redacted).toContain("Free Form Fitness");
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
