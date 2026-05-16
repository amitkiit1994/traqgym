import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../src/data/csv-parse.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, "fixtures/payments-mini.csv"), "utf8");

describe("parseCsv", () => {
  it("returns rows with header keys preserved", () => {
    const { rows, columns } = parseCsv(fixture);
    expect(columns).toContain("Payment Date");
    expect(columns).toContain("Paid Amount");
    expect(rows.length).toBe(4);
  });

  it("coerces DD-MM-YYYY dates to ISO YYYY-MM-DD", () => {
    const { rows } = parseCsv(fixture, { dateColumns: ["Payment Date"] });
    expect(rows[0]!["Payment Date"]).toBe("2026-04-01");
    expect(rows[1]!["Payment Date"]).toBe("2026-04-02");
    expect(rows[3]!["Payment Date"]).toBe(null);
  });

  it("coerces money strings with commas to numbers", () => {
    const { rows } = parseCsv(fixture, { numberColumns: ["Paid Amount"] });
    expect(rows[0]!["Paid Amount"]).toBe(2000);
    expect(rows[1]!["Paid Amount"]).toBe(1200);
    expect(rows[2]!["Paid Amount"]).toBe(15000);
  });

  it("treats blank cells as null after coercion", () => {
    const { rows } = parseCsv(fixture);
    expect(rows[3]!["Bill No"]).toBe(null);
  });
});
