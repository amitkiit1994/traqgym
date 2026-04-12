import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatCurrency,
  timeAgo,
  stripMarkdown,
} from "@/lib/utils/format";
import { generateCode } from "@/lib/services/gift-cards";

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------
describe("formatCurrency", () => {
  it("formats zero", () => {
    const result = formatCurrency(0);
    expect(result).toContain("0");
    expect(result).toContain("₹");
  });

  it("formats a typical amount with Indian grouping", () => {
    // 1500 => ₹1,500
    const result = formatCurrency(1500);
    expect(result).toBe("₹1,500");
  });

  it("formats negative numbers", () => {
    const result = formatCurrency(-500);
    expect(result).toContain("500");
    expect(result).toMatch(/-/);
  });

  it("formats large numbers with Indian comma grouping (lakhs/crores)", () => {
    // 15,00,000 in Indian grouping
    const result = formatCurrency(1500000);
    expect(result).toBe("₹15,00,000");
  });

  it("truncates decimals (maximumFractionDigits: 0)", () => {
    const result = formatCurrency(1999.99);
    // Should round to 2000 or show 2,000 — no decimal point
    expect(result).not.toContain(".");
  });
});

// ---------------------------------------------------------------------------
// timeAgo
// ---------------------------------------------------------------------------
describe("timeAgo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for less than 60 seconds ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T12:00:30.000Z"));
    expect(timeAgo(new Date("2026-04-11T12:00:00.000Z"))).toBe("just now");
  });

  it('returns "1m ago" for exactly 60 seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T12:01:00.000Z"));
    expect(timeAgo(new Date("2026-04-11T12:00:00.000Z"))).toBe("1m ago");
  });

  it('returns "30m ago" for 30 minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T12:30:00.000Z"));
    expect(timeAgo(new Date("2026-04-11T12:00:00.000Z"))).toBe("30m ago");
  });

  it('returns "1h ago" for 60 minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T13:00:00.000Z"));
    expect(timeAgo(new Date("2026-04-11T12:00:00.000Z"))).toBe("1h ago");
  });

  it('returns "23h ago" for 23 hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T11:00:00.000Z"));
    expect(timeAgo(new Date("2026-04-11T12:00:00.000Z"))).toBe("23h ago");
  });

  it('returns "1d ago" for 24 hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-12T12:00:00.000Z"));
    expect(timeAgo(new Date("2026-04-11T12:00:00.000Z"))).toBe("1d ago");
  });

  it('returns "7d ago" for a week', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-18T12:00:00.000Z"));
    expect(timeAgo(new Date("2026-04-11T12:00:00.000Z"))).toBe("7d ago");
  });

  it("accepts a string date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-11T12:05:00.000Z"));
    expect(timeAgo("2026-04-11T12:00:00.000Z")).toBe("5m ago");
  });
});

// ---------------------------------------------------------------------------
// stripMarkdown
// ---------------------------------------------------------------------------
describe("stripMarkdown", () => {
  it("strips heading markers (## Title)", () => {
    expect(stripMarkdown("## Hello World")).toBe("Hello World");
  });

  it("strips multiple heading levels", () => {
    expect(stripMarkdown("# H1\n## H2\n### H3")).toBe("H1 H2 H3");
  });

  it("strips bold (**text**)", () => {
    expect(stripMarkdown("This is **bold** text")).toBe("This is bold text");
  });

  it("strips italic (*text*)", () => {
    expect(stripMarkdown("This is *italic* text")).toBe("This is italic text");
  });

  it("strips inline code (`text`)", () => {
    expect(stripMarkdown("Use `console.log` here")).toBe(
      "Use console.log here"
    );
  });

  it("strips list item markers (- item)", () => {
    expect(stripMarkdown("- First\n- Second")).toBe("First Second");
  });

  it("strips list item markers (* item)", () => {
    expect(stripMarkdown("* First\n* Second")).toBe("First Second");
  });

  it("collapses multiple newlines into spaces", () => {
    expect(stripMarkdown("Line one\n\n\nLine two")).toBe("Line one Line two");
  });

  it("trims leading and trailing whitespace", () => {
    expect(stripMarkdown("  hello  ")).toBe("hello");
  });

  it("handles combined markdown", () => {
    const input = "## Summary\n**Revenue**: `₹50,000`\n- Item one\n- Item two";
    const result = stripMarkdown(input);
    expect(result).not.toContain("##");
    expect(result).not.toContain("**");
    expect(result).not.toContain("`");
    expect(result).not.toContain("- ");
    expect(result).toContain("Revenue");
    expect(result).toContain("₹50,000");
  });
});

// ---------------------------------------------------------------------------
// generateCode (gift card)
// ---------------------------------------------------------------------------
describe("generateCode", () => {
  it("returns a string of length 8", () => {
    expect(generateCode()).toHaveLength(8);
  });

  it("only contains allowed characters (no 0, O, I, 1)", () => {
    const forbidden = /[0OI1]/;
    for (let i = 0; i < 100; i++) {
      const code = generateCode();
      expect(code).not.toMatch(forbidden);
    }
  });

  it("only uses uppercase letters and digits from the allowed set", () => {
    const allowed = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;
    for (let i = 0; i < 100; i++) {
      expect(generateCode()).toMatch(allowed);
    }
  });

  it("generates unique codes across 1000 generations", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      codes.add(generateCode());
    }
    // With 31^8 (~8.5e11) possible codes, collisions in 1000 should be essentially zero
    expect(codes.size).toBe(1000);
  });
});
