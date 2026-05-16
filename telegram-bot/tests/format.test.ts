import { describe, it, expect } from "vitest";
import { formatINR } from "../src/telegram/format.js";

describe("formatINR", () => {
  it("formats lakh with Indian commas", () => {
    expect(formatINR(305700)).toBe("₹3,05,700");
  });
  it("formats thousand", () => {
    expect(formatINR(2000)).toBe("₹2,000");
  });
  it("formats crore", () => {
    expect(formatINR(12345678)).toBe("₹1,23,45,678");
  });
  it("formats zero", () => {
    expect(formatINR(0)).toBe("₹0");
  });
  it("rounds decimals to integer rupees", () => {
    expect(formatINR(2000.5)).toBe("₹2,001");
  });
  it("handles negative", () => {
    expect(formatINR(-500)).toBe("-₹500");
  });
});
